import { useApp } from '../../state/AppContext';
import { pickBackup, saveBackup } from '../../ui/backup';
import { localDate } from '../../ui/format';
import { Group, Row } from '../../ui/primitives';
import { Note, SubScreen } from '../../ui/SubScreen';

export default function Backup() {
  const { t, repo, showToast } = useApp();
  return (
    <SubScreen title={t('backup')}>
      <Note>{t('backupNote')}</Note>
      <Group>
        <Row
          label={t('exportData')}
          onPress={async () => {
            const data = await repo.exportAll();
            await saveBackup(`modo-${localDate(new Date())}.json`, JSON.stringify(data, null, 2));
          }}
        />
        <Row
          label={t('importData')}
          onPress={async () => {
            const text = await pickBackup();
            if (!text) return;
            try {
              const data = JSON.parse(text);
              // 예전 이름(naegirok)으로 내보낸 백업도 받는다
              if (data?.app !== 'modo' && data?.app !== 'naegirok') throw new Error('format');
              const r = await repo.importAll(data);
              showToast({ message: t('imported', r) });
            } catch {
              showToast({ message: t('notBackup') });
            }
          }}
          last
        />
      </Group>
    </SubScreen>
  );
}
