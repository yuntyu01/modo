import { useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';

import { DELETION_URL, POLICY_URL } from '../../policies';
import { codeText, errorText } from '../../i18n';
import { desktop } from '../../native/bridge';
import { useApp, useSyncStatus } from '../../state/AppContext';
import { formatDateTime } from '../../ui/format';
import { ConfirmDialog, Group, Row } from '../../ui/primitives';
import { Note, SubScreen } from '../../ui/SubScreen';
import { useOpenUrl } from '../../ui/openUrl';

export default function Account() {
  const { theme, t, account, sync, refreshAccount, deleteAccount, showToast, lang } = useApp();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const open = useOpenUrl();
  const policyLinks = (
    <Group>
      <Row label={t('privacyPolicy')} onPress={() => open(POLICY_URL)} />
      <Row label={t('requestAccountDeletion')} danger onPress={() => open(DELETION_URL)} last />
    </Group>
  );

  const stateText = {
    local: t('notSignedIn'),
    idle: t('syncIdle'),
    syncing: t('syncing'),
    offline: t('syncOffline'),
    error: `${t('syncError')}: ${codeText(status.code, status.message ?? '', t)}`,
    expired: t('syncExpired'),
  }[status.state];

  // 로그인해야 들어오는 화면이다(로그아웃·만료면 AuthGuard가 로그인 화면으로 보낸다). 로그인 전 화면은 없앴다
  if (!account) return null;

  return (
    <SubScreen title={t('account')}>
      <Group>
        <Row label={account.email ? t('email') : t('account')} value={account.email || account.name || ''} />
        <Row label={t('server')} value={account.server} />
        <Row label={stateText} right={status.state === 'syncing' ? <ActivityIndicator color={theme.muted} /> : <View />} />
        {status.lastSyncAt ? <Row label={t('lastSync', { time: formatDateTime(status.lastSyncAt, lang) })} right={<View />} /> : null}
        {status.pending ? <Row label={t('pendingChanges', { n: status.pending })} right={<View />} /> : null}
        {status.rejected ? <Row label={t('rejected', { n: status.rejected })} right={<View />} /> : null}
        <Row label={t('syncNow')} onPress={() => sync.syncNow().then(() => showToast({ message: t('syncIdle') }))} last />
      </Group>
      <Note>{t('accountSignedIn')}</Note>
      {policyLinks}
      <Group>
        {Platform.OS !== 'web' || desktop ? <Row label={t('deleteAccount')} danger onPress={busy ? undefined : () => setConfirmDeletion(true)} /> : null}
        <Row label={t('logout')} danger onPress={busy ? undefined : () => setConfirmLogout(true)} last />
      </Group>
      {busy ? <ActivityIndicator color={theme.accent} /> : null}
      {error ? <Text style={theme.font(14, { color: theme.danger })}>{error}</Text> : null}
      <ConfirmDialog
        visible={confirmDeletion}
        title={t('deleteAccount')}
        body={t('deleteAccountBody')}
        confirmLabel={t('deleteAccount')}
        danger
        onConfirm={async () => {
          setBusy(true); setError(null);
          try { await deleteAccount(); showToast({ message: t('accountDeletionAccepted') }); }
          catch (e) { setError(errorText(e, t)); }
          finally { setBusy(false); }
        }}
        onClose={() => setConfirmDeletion(false)}
      />
      <ConfirmDialog
        visible={confirmLogout}
        title={t('logout')}
        body={t('logoutBody')}
        confirmLabel={t('logout')}
        danger
        onConfirm={async () => {
          await sync.logout();
          await refreshAccount();
        }}
        onClose={() => setConfirmLogout(false)}
      />
    </SubScreen>
  );
}
