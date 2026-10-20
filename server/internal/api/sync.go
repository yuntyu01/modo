package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type kind int

const (
	kText    kind = iota // NOT NULL 문자열
	kInt                 // NULL 가능 정수(ms 시각)
	kDate                // NULL 가능 'YYYY-MM-DD'
	kUUID                // NULL 가능 UUID
	kKey                 // NOT NULL 정렬 키
	kEnum                // NULL 가능, 정해진 문자열 중 하나
	kDateSet             // NULL 가능, 'YYYY-MM-DD'를 쉼표로 이은 집합(루틴을 한 날). 기기마다 보낸 추가·삭제를 합친다
)

// 루틴을 한 날 기록은 최근 이만큼만 둔다(앱 core/doneLog.ts와 같다)
const dateSetMax = 400

type field struct {
	kind     kind
	max      int      // 문자열 최대 길이(룬)
	copyOnly bool     // 다른 기기와 동시에 바뀌면 덮어쓰지 않고 충돌 사본을 만든다
	required bool     // 생성 시 필수
	enum     []string // kEnum 허용 값
	rng      [2]int64 // kInt 허용 범위(둘 다 0이면 제한 없음)
}

type entity struct {
	table  string
	fields map[string]field
}

// 항목(할 일·문단)은 필드 말고 "purged": true 로 영구 삭제를 보낸다(행을 지우고 tombstones에 남긴다).
var entities = map[string]entity{
	"folder": {table: "folders", fields: map[string]field{
		"name":       {kind: kText, max: 40, required: true},
		"position":   {kind: kKey, required: true},
		"created_at": {kind: kInt, required: true},
		"updated_at": {kind: kInt, required: true},
		"deleted_at": {kind: kInt},
	}},
	"todo": {table: "todos", fields: map[string]field{
		"folder_id": {kind: kUUID},
		"text":      {kind: kText, max: 5000, copyOnly: true, required: true},
		"done_at":   {kind: kInt},
		"due_date":  {kind: kDate},
		"remind_at": {kind: kInt},
		// 반복: 매일/매주/매월, 매주면 요일 비트(월=1 … 일=64). DB의 CHECK와 같은 범위
		"repeat_freq": {kind: kEnum, enum: []string{"daily", "weekly", "monthly"}},
		"repeat_days": {kind: kInt, rng: [2]int64{1, 127}},
		"done_log":    {kind: kDateSet},
		"position":    {kind: kKey, required: true},
		"created_at":  {kind: kInt, required: true},
		"updated_at":  {kind: kInt, required: true},
		"deleted_at":  {kind: kInt},
	}},
	"paragraph": {table: "paragraphs", fields: map[string]field{
		"folder_id":  {kind: kUUID},
		"text":       {kind: kText, max: 20000, copyOnly: true, required: true},
		"position":   {kind: kKey, required: true},
		"created_at": {kind: kInt, required: true},
		"updated_at": {kind: kInt, required: true},
		"deleted_at": {kind: kInt},
	}},
}

type change struct {
	Old json.RawMessage `json:"old"`
	New json.RawMessage `json:"new"`
}

type op struct {
	OpID   string            `json:"op_id"`
	Entity string            `json:"entity"`
	ID     uuid.UUID         `json:"id"`
	Create bool              `json:"create"`
	Fields map[string]change `json:"fields"`
}

type opResult struct {
	OpID      string     `json:"op_id"`
	Status    string     `json:"status"` // ok | conflict | forbidden | invalid | gone(영구 삭제된 항목: 클라이언트도 지운다)
	Message   string     `json:"message,omitempty"`
	CopyID    *uuid.UUID `json:"copy_id,omitempty"`
	Conflicts []string   `json:"conflicts,omitempty"`
}

// 쓰기는 공유 잠금, pull은 배타 잠금을 잡는다. pull 시점에 진행 중인 쓰기가 없으니
// 커서보다 작은 seq가 나중에 커밋돼 영영 안 내려가는 일이 없다.
const seqLock = 7_331_001

func (s *Server) push(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	var body struct {
		Ops []op `json:"ops"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.Ops) > 500 {
		badRequest(w, "한 번에 500개까지 보낼 수 있습니다")
		return
	}
	results, err := s.applyOps(r.Context(), u.ID, body.Ops)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

type rowKey struct {
	table string
	id    uuid.UUID
}

type folderInfo struct {
	owner uuid.UUID
	role  string // owner | edit | view | none (이 push를 보낸 사람 기준)
}

// pushTx: 한 번의 push를 한 트랜잭션으로 처리한다. 필요한 행·폴더·재전송 기록을 먼저 한꺼번에 읽고(FOR UPDATE),
// op를 순서대로 메모리에서 판정한 뒤 쓰기를 한 번에 보낸다. 예전에는 op마다 트랜잭션을 열어 8번쯤 왕복했다.
// 같은 push 안에서 앞 op가 만든·바꾼 행은 rows/folders에 반영해 뒤 op가 본다.
type pushTx struct {
	user    uuid.UUID
	rows    map[rowKey]map[string]json.RawMessage
	folders map[uuid.UUID]folderInfo
	tomb    map[uuid.UUID]bool
	applied map[string]opResult
	batch   pgx.Batch
}

// 한 push를 한 트랜잭션으로. 어떤 op가 DB 제약(데이터 오류·무결성)에 걸리면 묶음 전체가 롤백되므로,
// 그때는 op마다 따로 다시 처리해 걸린 op만 invalid로 남긴다. 그러지 않으면 같은 묶음을 영영 다시 보내 동기화가 멈춘다.
func (s *Server) applyOps(ctx context.Context, user uuid.UUID, ops []op) ([]opResult, error) {
	results, err := s.applyOpsTx(ctx, user, ops)
	if !isDataError(err) {
		return results, err
	}
	results = make([]opResult, len(ops))
	for i, o := range ops {
		r, err := s.applyOpsTx(ctx, user, []op{o})
		switch {
		case err == nil:
			results[i] = r[0]
		case isDataError(err):
			results[i] = opResult{OpID: o.OpID, Status: "invalid", Message: "db: " + err.(*pgconn.PgError).Code}
			b, _ := json.Marshal(results[i])
			if _, err := s.db.Exec(ctx, `INSERT INTO applied_ops (user_id, op_id, result) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, user, o.OpID, b); err != nil {
				return nil, err
			}
		default:
			return nil, err
		}
	}
	return results, nil
}

// 데이터 오류(22xxx)·무결성 위반(23xxx): 같은 op를 다시 보내도 또 실패한다. 교착(40P01) 같은 일시 오류는 아니다.
func isDataError(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && (strings.HasPrefix(pg.Code, "22") || strings.HasPrefix(pg.Code, "23"))
}

func (s *Server) applyOpsTx(ctx context.Context, user uuid.UUID, ops []op) ([]opResult, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared($1)`, seqLock); err != nil {
		return nil, err
	}
	p := &pushTx{
		user:    user,
		rows:    map[rowKey]map[string]json.RawMessage{},
		folders: map[uuid.UUID]folderInfo{},
		tomb:    map[uuid.UUID]bool{},
		applied: map[string]opResult{},
	}
	if err := p.load(ctx, tx, ops); err != nil {
		return nil, err
	}
	results := make([]opResult, len(ops))
	for i, o := range ops {
		if o.OpID == "" || len(o.OpID) > 64 {
			results[i] = opResult{OpID: o.OpID, Status: "invalid", Message: "op_id"}
			continue
		}
		if prev, ok := p.applied[o.OpID]; ok {
			results[i] = prev
			continue
		}
		res := p.apply(o)
		res.OpID = o.OpID
		b, _ := json.Marshal(res)
		p.batch.Queue(`INSERT INTO applied_ops (user_id, op_id, result) VALUES ($1, $2, $3)`, user, o.OpID, b)
		p.applied[o.OpID] = res
		results[i] = res
	}
	if p.batch.Len() > 0 {
		br := tx.SendBatch(ctx, &p.batch)
		for range p.batch.Len() {
			if _, err := br.Exec(); err != nil {
				br.Close()
				return nil, err
			}
		}
		if err := br.Close(); err != nil {
			return nil, err
		}
	}
	return results, tx.Commit(ctx)
}

func (p *pushTx) load(ctx context.Context, tx pgx.Tx, ops []op) error {
	opIDs := []string{}
	ids := map[string][]uuid.UUID{}
	items := []uuid.UUID{}
	folderIDs := []uuid.UUID{}
	for _, o := range ops {
		opIDs = append(opIDs, o.OpID)
		ent, ok := entities[o.Entity]
		if !ok || o.ID == uuid.Nil {
			continue
		}
		ids[ent.table] = append(ids[ent.table], o.ID)
		if o.Entity == "folder" {
			folderIDs = append(folderIDs, o.ID)
			continue
		}
		items = append(items, o.ID)
		var fid uuid.UUID
		if ch, ok := o.Fields["folder_id"]; ok && json.Unmarshal(ch.New, &fid) == nil && fid != uuid.Nil {
			folderIDs = append(folderIDs, fid)
		}
	}

	rows, err := tx.Query(ctx, `SELECT op_id, result FROM applied_ops WHERE user_id = $1 AND op_id = ANY($2)`, p.user, opIDs)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var b []byte
		var res opResult
		if err := rows.Scan(&id, &b); err != nil {
			rows.Close()
			return err
		}
		json.Unmarshal(b, &res)
		p.applied[id] = res
	}
	rows.Close()

	// 잠그는 순서를 늘 같게(표 순서, id 순서): 두 push가 서로 반대 순서로 잠가 교착되지 않게
	for _, table := range []string{"folders", "todos", "paragraphs"} {
		list := ids[table]
		if len(list) == 0 {
			continue
		}
		rows, err := tx.Query(ctx, fmt.Sprintf(`SELECT id, to_jsonb(t) - 'seq' FROM %s t WHERE id = ANY($1) ORDER BY id FOR UPDATE`, table), list)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id uuid.UUID
			var b []byte
			if err := rows.Scan(&id, &b); err != nil {
				rows.Close()
				return err
			}
			cur := map[string]json.RawMessage{}
			json.Unmarshal(b, &cur)
			p.rows[rowKey{table, id}] = cur
			var fid uuid.UUID
			if json.Unmarshal(cur["folder_id"], &fid) == nil && fid != uuid.Nil {
				folderIDs = append(folderIDs, fid)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}

	if len(items) > 0 {
		rows, err := tx.Query(ctx, `SELECT id FROM tombstones WHERE id = ANY($1)`, items)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id uuid.UUID
			rows.Scan(&id)
			p.tomb[id] = true
		}
		rows.Close()
	}

	if len(folderIDs) > 0 {
		rows, err := tx.Query(ctx, `
			SELECT f.id, f.owner_id, m.role FROM folders f
			LEFT JOIN folder_members m ON m.folder_id = f.id AND m.user_id = $2
			WHERE f.id = ANY($1)`, folderIDs, p.user)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id, owner uuid.UUID
			var role *string
			if err := rows.Scan(&id, &owner, &role); err != nil {
				rows.Close()
				return err
			}
			fi := folderInfo{owner: owner, role: "none"}
			if owner == p.user {
				fi.role = "owner"
			} else if role != nil {
				fi.role = *role
			}
			p.folders[id] = fi
		}
		rows.Close()
	}
	return nil
}

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
var keyRe = regexp.MustCompile(`^[0-9A-Za-z]{1,200}$`)

// JSON 값을 SQL 파라미터로 바꾸며 검증한다.
func convert(f field, raw json.RawMessage) (any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		if f.kind == kText || f.kind == kKey {
			return nil, errors.New("null 불가")
		}
		return nil, nil
	}
	switch f.kind {
	case kText, kKey:
		var v string
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		if f.kind == kKey && !keyRe.MatchString(v) {
			return nil, errors.New("정렬 키 형식")
		}
		if f.max > 0 && utf8.RuneCountInString(v) > f.max {
			return nil, errors.New("너무 김")
		}
		if !utf8.ValidString(v) || strings.ContainsRune(v, 0) {
			return nil, errors.New("글자 형식") // PostgreSQL TEXT는 NUL을 받지 않는다
		}
		return v, nil
	case kInt:
		var v int64
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		if f.rng != [2]int64{} && (v < f.rng[0] || v > f.rng[1]) {
			return nil, errors.New("범위 밖")
		}
		return v, nil
	case kEnum:
		var v string
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		if !slices.Contains(f.enum, v) {
			return nil, errors.New("허용되지 않는 값")
		}
		return v, nil
	case kDateSet:
		var v string
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		days, err := parseDateSet(v)
		if err != nil {
			return nil, err
		}
		return joinDateSet(days), nil
	case kDate:
		var v string
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		if d, err := time.Parse("2006-01-02", v); err != nil || !dateRe.MatchString(v) || d.Year() < 1 {
			return nil, errors.New("날짜 형식")
		}
		return v, nil
	case kUUID:
		var v uuid.UUID
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		if v == uuid.Nil {
			return nil, nil // 0으로 된 UUID는 '없음'
		}
		return v, nil
	}
	return nil, errors.New("unknown kind")
}

func jsonEqual(a, b json.RawMessage) bool {
	var x, y any
	if len(a) == 0 {
		a = json.RawMessage("null")
	}
	if len(b) == 0 {
		b = json.RawMessage("null")
	}
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	return reflect.DeepEqual(x, y)
}

func raw(v any) json.RawMessage {
	if id, ok := v.(uuid.UUID); ok && id == uuid.Nil {
		return json.RawMessage("null")
	}
	b, _ := json.Marshal(v)
	return b
}

func uuidOf(r json.RawMessage) uuid.UUID {
	var id uuid.UUID
	json.Unmarshal(r, &id)
	return id
}

// nullable: uuid.Nil → SQL NULL
func nullable(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func (p *pushTx) apply(o op) opResult {
	ent, ok := entities[o.Entity]
	if !ok || o.ID == uuid.Nil || len(o.Fields) == 0 {
		return opResult{Status: "invalid", Message: "entity/id/fields"}
	}
	purge := false
	values := map[string]any{}
	for name, ch := range o.Fields {
		if name == "purged" && o.Entity != "folder" {
			if err := json.Unmarshal(ch.New, &purge); err != nil {
				return opResult{Status: "invalid", Message: "purged"}
			}
			continue
		}
		f, ok := ent.fields[name]
		if !ok {
			return opResult{Status: "invalid", Message: "unknown field " + name}
		}
		v, err := convert(f, ch.New)
		if err != nil {
			return opResult{Status: "invalid", Message: name + ": " + err.Error()}
		}
		values[name] = v
	}
	if p.tomb[o.ID] {
		return opResult{Status: "gone", Message: "이미 영구 삭제된 항목"}
	}
	key := rowKey{ent.table, o.ID}
	cur, exists := p.rows[key]
	if !exists {
		return p.insert(o, ent, key, values, purge)
	}
	return p.update(o, ent, key, values, cur, purge)
}

func (p *pushTx) insert(o op, ent entity, key rowKey, values map[string]any, purge bool) opResult {
	if purge {
		return opResult{Status: "ok"} // 서버에 온 적 없는 항목: 지울 것도 없다
	}
	for name, f := range ent.fields {
		if _, ok := values[name]; f.required && !ok {
			return opResult{Status: "invalid", Message: "missing " + name}
		}
	}
	owner := nullable(p.user)
	res := opResult{Status: "ok"}
	if o.Entity == "folder" {
		p.folders[o.ID] = folderInfo{owner: p.user, role: "owner"}
	} else if fid, _ := values["folder_id"].(uuid.UUID); fid != uuid.Nil {
		fi, ok := p.folders[fid]
		switch {
		case !ok:
			// 폴더가 서버에 없다(폴더 생성이 거절됐거나 순서가 꼬였다). 내용을 잃지 않게 기본 폴더에 둔다.
			values["folder_id"] = nil
			res.Message = "폴더가 없어 기본 폴더에 저장했습니다"
		case fi.role == "owner" || fi.role == "edit":
			owner = nil // 폴더 항목의 주인은 폴더 주인
		default:
			return opResult{Status: "forbidden", Message: "폴더에 쓸 권한이 없습니다"}
		}
	}
	cols := []string{"id", "owner_id"}
	args := []any{o.ID, owner}
	cur := map[string]json.RawMessage{"id": raw(o.ID), "owner_id": raw(owner)}
	for name, v := range values {
		cols = append(cols, name)
		args = append(args, v)
		cur[name] = raw(v)
	}
	ph := make([]string, len(args))
	for i := range args {
		ph[i] = "$" + strconv.Itoa(i+1)
	}
	p.batch.Queue(fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, ent.table, strings.Join(cols, ", "), strings.Join(ph, ", ")), args...)
	p.rows[key] = cur
	return res
}

func (p *pushTx) update(o op, ent entity, key rowKey, values map[string]any, cur map[string]json.RawMessage, purge bool) opResult {
	rowFolder := uuidOf(cur["folder_id"])
	rowOwner := uuidOf(cur["owner_id"])
	if rowFolder != uuid.Nil {
		rowOwner = p.folders[rowFolder].owner
	}

	// 권한: 폴더는 소유자만, 항목은 소유자 또는 그 폴더의 편집 권한자.
	if rowOwner != p.user {
		if o.Entity == "folder" || rowFolder == uuid.Nil || p.folders[rowFolder].role != "edit" {
			return opResult{Status: "forbidden", Message: "권한이 없습니다"}
		}
	}

	if purge {
		p.batch.Queue(fmt.Sprintf(`DELETE FROM %s WHERE id = $1`, ent.table), o.ID)
		var tombOwner any
		if rowFolder == uuid.Nil {
			tombOwner = rowOwner
		}
		p.batch.Queue(`INSERT INTO tombstones (id, entity, folder_id, owner_id) VALUES ($1, $2, $3, $4)`, o.ID, o.Entity, nullable(rowFolder), tombOwner)
		delete(p.rows, key)
		p.tomb[o.ID] = true
		return opResult{Status: "ok"}
	}

	if o.Create {
		return p.createOnExisting(o, ent, values, cur)
	}

	sets := []string{}
	args := []any{o.ID}
	set := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
		cur[col] = raw(v)
	}

	if v, ok := values["folder_id"]; ok && !jsonEqual(cur["folder_id"], o.Fields["folder_id"].New) {
		target, _ := v.(uuid.UUID)
		if target == uuid.Nil {
			if p.user != rowOwner {
				return opResult{Status: "forbidden", Message: "공유 폴더 밖으로 옮길 수 없습니다"}
			}
			set("owner_id", rowOwner)
		} else {
			fi, ok := p.folders[target]
			if !ok {
				return opResult{Status: "forbidden", Message: "그 폴더가 아직 서버에 없습니다"}
			}
			if fi.owner != rowOwner || (fi.role != "owner" && fi.role != "edit") {
				return opResult{Status: "forbidden", Message: "그 폴더로 옮길 수 없습니다"}
			}
			set("owner_id", nil)
		}
	}

	res := opResult{Status: "ok"}
	for name, v := range values {
		f := ent.fields[name]
		ch := o.Fields[name]
		// 날짜 집합은 덮어쓰지 않고 합친다: 이 기기가 더한 날은 더하고 뺀 날만 뺀다(다른 기기가 그사이 더한 날은 남는다)
		if f.kind == kDateSet {
			set(name, mergeDateSet(cur[name], ch.Old, v))
			continue
		}
		// 서버 값이 이 기기가 알던 값(old)과도, 새 값과도 다르면 그 사이 다른 기기가 바꾼 것이다.
		concurrent := !jsonEqual(cur[name], ch.Old) && !jsonEqual(cur[name], ch.New)
		if concurrent && f.kind == kText {
			res.Status = "conflict"
			res.Conflicts = append(res.Conflicts, name)
			if f.copyOnly {
				id := p.conflictCopy(ent, o.ID, v.(string))
				res.CopyID = &id
			}
			continue // 서버 쪽 내용은 그대로 둔다
		}
		set(name, v)
	}
	if len(sets) > 0 {
		sets = append(sets, "seq = nextval('change_seq')")
		p.batch.Queue(fmt.Sprintf(`UPDATE %s SET %s WHERE id = $1`, ent.table, strings.Join(sets, ", ")), args...)
	}
	return res
}

// 이미 서버에 있는 행에 '만들기'가 왔다: 로그아웃 뒤 다시 로그인해 전부 다시 올릴 때, 백업 가져오기 등.
// 이 기기가 알던 값(old)이 없으니 무엇이 더 새로운지 모른다. 서버 것을 덮어쓰지 않는다:
// 같은 값은 그대로, 다른 글(메모·할 일 내용)은 충돌 사본으로 남기고, 그 밖의 값(완료·날짜·폴더 등)은 서버 값을 둔다.
func (p *pushTx) createOnExisting(o op, ent entity, values map[string]any, cur map[string]json.RawMessage) opResult {
	res := opResult{Status: "ok"}
	for name, v := range values {
		// 날짜 집합은 서버 것과 합친다(다시 올린 기기가 기억하는 한 날도 잃지 않게)
		if ent.fields[name].kind == kDateSet {
			if merged := mergeDateSet(cur[name], nil, v); !jsonEqual(cur[name], raw(merged)) {
				p.batch.Queue(fmt.Sprintf(`UPDATE %s SET %s = $2, seq = nextval('change_seq') WHERE id = $1`, ent.table, name), o.ID, merged)
				cur[name] = raw(merged)
			}
			continue
		}
		if jsonEqual(cur[name], o.Fields[name].New) || !ent.fields[name].copyOnly {
			continue
		}
		id := p.conflictCopy(ent, o.ID, v.(string))
		res.Status = "conflict"
		res.Conflicts = append(res.Conflicts, name)
		res.CopyID = &id
	}
	return res
}

// 원본 바로 뒤에 같은 폴더로 사본을 만든다. 정렬 키에 문자를 덧붙이면 원본 바로 뒤로 간다.
// 같은 push의 UPDATE보다 먼저 큐에 넣어 원본의 바뀌기 전 폴더·주인을 복사한다.
func (p *pushTx) conflictCopy(ent entity, id uuid.UUID, text string) uuid.UUID {
	copyID := uuid.New()
	now := time.Now().UnixMilli()
	extra := ""
	if ent.table == "todos" {
		extra = ", done_at, due_date"
	}
	p.batch.Queue(fmt.Sprintf(`
		INSERT INTO %[1]s (id, owner_id, folder_id, text, position, created_at, updated_at, conflict_of%[2]s)
		SELECT $2, owner_id, folder_id, $3, position || 'V', $4, $4, id%[2]s FROM %[1]s WHERE id = $1`, ent.table, extra),
		id, copyID, text, now)
	return copyID
}

type pulled struct {
	seq int64
	ent string
	row json.RawMessage
}

type sharedFolder struct {
	FolderID uuid.UUID `json:"folder_id"`
	Role     string    `json:"role"`
	Owner    person    `json:"owner"`
	// 내 홈(목록 탭)에도 보일지(참여자 각자의 설정). 예전 앱은 이 필드를 모른다(늘 보인다)
	Home bool `json:"home"`
}

type person struct {
	ID    uuid.UUID `json:"id"`
	Email string    `json:"email"`
	Name  string    `json:"name"`
}

func (s *Server) pull(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, seqLock); err != nil {
		serverError(w, err)
		return
	}

	shared := []sharedFolder{}
	rows, err := tx.Query(ctx, `
		SELECT m.folder_id, m.role, o.id, COALESCE(o.email, ''), o.name, m.home FROM folder_members m
		JOIN folders f ON f.id = m.folder_id JOIN users o ON o.id = f.owner_id
		WHERE m.user_id = $1`, u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var sf sharedFolder
		rows.Scan(&sf.FolderID, &sf.Role, &sf.Owner.ID, &sf.Owner.Email, &sf.Owner.Name, &sf.Home)
		shared = append(shared, sf)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	sharedIDs := make([]uuid.UUID, len(shared))
	for i, sf := range shared {
		sharedIDs[i] = sf.FolderID
	}
	// 볼 수 있는 폴더 = 내 폴더 + 공유받은 폴더. 폴더에 든 항목은 이 목록으로, 기본 폴더 항목은 owner_id로 찾는다.
	visible := slices.Clone(sharedIDs)
	rows, err = tx.Query(ctx, `SELECT id FROM folders WHERE owner_id = $1`, u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var id uuid.UUID
		rows.Scan(&id)
		visible = append(visible, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}

	// 두 갈래를 각각 (owner_id, seq) / (folder_id, seq) 인덱스로 읽는다.
	items := func(table, cols string) string {
		return fmt.Sprintf(`(SELECT seq, %[2]s FROM %[1]s t WHERE owner_id = $2 AND seq > $1 ORDER BY seq LIMIT $4)
			UNION ALL (SELECT seq, %[2]s FROM %[1]s t WHERE folder_id = ANY($3) AND seq > $1 ORDER BY seq LIMIT $4)`, table, cols)
	}
	queries := []struct {
		name, sql string
		folders   []uuid.UUID
	}{
		{"folders", `SELECT seq, to_jsonb(t) - 'seq' - 'owner_id' FROM folders t WHERE seq > $1 AND (owner_id = $2 OR id = ANY($3)) ORDER BY seq LIMIT $4`, sharedIDs},
		{"todos", items("todos", `to_jsonb(t) - 'seq' - 'owner_id'`), visible},
		{"paragraphs", items("paragraphs", `to_jsonb(t) - 'seq' - 'owner_id'`), visible},
		{"deleted", items("tombstones", `jsonb_build_object('id', id, 'entity', entity)`), visible},
	}
	all := []pulled{}
	more := false
	for _, q := range queries {
		rows, err := tx.Query(ctx, q.sql, since, u.ID, q.folders, limit+1)
		if err != nil {
			serverError(w, err)
			return
		}
		n := 0
		for rows.Next() {
			p := pulled{ent: q.name}
			if err := rows.Scan(&p.seq, &p.row); err != nil {
				rows.Close()
				serverError(w, err)
				return
			}
			all = append(all, p)
			n++
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			serverError(w, err)
			return
		}
		if n > limit {
			more = true
		}
	}
	slices.SortFunc(all, func(a, b pulled) int { return int(a.seq - b.seq) })
	if len(all) > limit {
		all = all[:limit]
		more = true
	}
	cursor := since
	out := map[string][]json.RawMessage{"folders": {}, "todos": {}, "paragraphs": {}, "deleted": {}}
	for _, p := range all {
		out[p.ent] = append(out[p.ent], p.row)
		cursor = p.seq
	}
	resp := map[string]any{
		"folders": out["folders"], "todos": out["todos"], "paragraphs": out["paragraphs"], "deleted": out["deleted"],
		"cursor": cursor, "more": more, "shared": shared,
	}
	// 마지막 페이지에는 '남의 폴더(공유받은 폴더)와 그 안의 항목' 전체 목록을 준다.
	// 공유가 끊기거나 항목이 공유 폴더 밖으로 옮겨지면 클라이언트가 이 목록으로 지운다.
	// 목록의 요약(foreign_digest)이 클라이언트가 보낸 것(fd)과 같으면 목록은 빼고 foreign_same만 준다:
	// 바뀐 게 없는 동기화(30초마다)에 공유 폴더 항목 수만큼의 id를 매번 보내지 않게(2026-10-18). fd를 안 보내는 예전 앱은 늘 목록을 받는다.
	if !more {
		ids := []uuid.UUID{}
		rows, err := tx.Query(ctx, `
			SELECT id FROM folders WHERE id = ANY($1)
			UNION ALL SELECT id FROM todos WHERE folder_id = ANY($1)
			UNION ALL SELECT id FROM paragraphs WHERE folder_id = ANY($1)`, sharedIDs)
		if err != nil {
			serverError(w, err)
			return
		}
		for rows.Next() {
			var id uuid.UUID
			rows.Scan(&id)
			ids = append(ids, id)
		}
		rows.Close()
		// 도중에 끊긴 목록을 주면 클라이언트가 빠진 공유 항목을 지운다
		if err := rows.Err(); err != nil {
			serverError(w, err)
			return
		}
		digest := foreignDigest(ids)
		resp["foreign_digest"] = digest
		if fd := r.URL.Query().Get("fd"); fd != "" && fd == digest {
			resp["foreign_same"] = true
		} else {
			resp["foreign_ids"] = ids
		}
		// 친구·받은/보낸 요청·친구별 함께 쓰는 폴더도 같은 동기화로(창마다 따로 묻지 않게). 요약(friends_digest)이
		// 클라이언트가 보낸 것(ffd)과 같으면 목록은 뺀다. 예전 앱은 ffd를 보내지 않고 이 필드를 무시한다
		fr, err := friendsOf(ctx, tx, u.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		fdg := friendsDigest(fr)
		resp["friends_digest"] = fdg
		if r.URL.Query().Get("ffd") != fdg {
			resp["friends"] = fr
		}
	}
	// 응답을 쓰기 전에 트랜잭션을 끝내 전역 잠금을 푼다: 느린 클라이언트가 응답을 받는 동안 모든 사용자의 push·pull이 멈추지 않게.
	tx.Rollback(ctx)
	writeJSON(w, http.StatusOK, resp)
}

// foreignDigest: 남의 항목 id 목록의 요약(순서와 상관없이 같은 목록이면 같은 값)
func foreignDigest(ids []uuid.UUID) string {
	sorted := slices.Clone(ids)
	slices.SortFunc(sorted, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	h := sha256.New()
	for _, id := range sorted {
		h.Write(id[:])
	}
	return strconv.Itoa(len(sorted)) + "-" + hex.EncodeToString(h.Sum(nil)[:12])
}

func parseDateSet(v string) ([]string, error) {
	if v == "" {
		return nil, nil
	}
	parts := strings.Split(v, ",")
	if len(parts) > dateSetMax*2 {
		return nil, errors.New("너무 김")
	}
	for _, d := range parts {
		if t, err := time.Parse("2006-01-02", d); err != nil || !dateRe.MatchString(d) || t.Year() < 1 {
			return nil, errors.New("날짜 형식")
		}
	}
	return parts, nil
}

// 정렬·중복 제거 후 최근 dateSetMax개. 비면 NULL
func joinDateSet(days []string) any {
	set := map[string]bool{}
	for _, d := range days {
		set[d] = true
	}
	list := make([]string, 0, len(set))
	for d := range set {
		list = append(list, d)
	}
	slices.Sort(list)
	if len(list) > dateSetMax {
		list = list[len(list)-dateSetMax:]
	}
	if len(list) == 0 {
		return nil
	}
	return strings.Join(list, ",")
}

// (서버 값 − 이 기기가 뺀 날) ∪ 이 기기가 더한 날. 더한 날 = 새 값 − 알던 값, 뺀 날 = 알던 값 − 새 값
func mergeDateSet(cur, old json.RawMessage, next any) any {
	read := func(r json.RawMessage) map[string]bool {
		out := map[string]bool{}
		var s *string
		if len(r) > 0 && json.Unmarshal(r, &s) == nil && s != nil {
			for _, d := range strings.Split(*s, ",") {
				if d != "" {
					out[d] = true
				}
			}
		}
		return out
	}
	curSet, oldSet := read(cur), read(old)
	newSet := map[string]bool{}
	if s, ok := next.(string); ok {
		for _, d := range strings.Split(s, ",") {
			newSet[d] = true
		}
	}
	out := []string{}
	for d := range curSet {
		if !(oldSet[d] && !newSet[d]) {
			out = append(out, d)
		}
	}
	for d := range newSet {
		if !oldSet[d] {
			out = append(out, d)
		}
	}
	return joinDateSet(out)
}
