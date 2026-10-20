import { LANG_NAMES, LANGS } from '../../i18n';
import { useUi } from '../../state/AppContext';
import type { Prefs } from '../../state/prefs';
import { CheckIcon } from '../../ui/Icons';
import { Group, Row } from '../../ui/primitives';
import { SubScreen } from '../../ui/SubScreen';

export default function Language() {
  const { t, prefs, setPrefs, theme } = useUi();
  const options: { value: Prefs['language']; label: string }[] = [
    { value: 'system', label: t('systemDefault') },
    ...LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] })),
  ];
  return (
    <SubScreen title={t('language')}>
      <Group>
        {options.map((o, i) => (
          <Row
            key={o.value}
            label={o.label}
            onPress={() => setPrefs({ language: o.value })}
            right={prefs.language === o.value ? <CheckIcon color={theme.accent} size={20} /> : <></>}
            last={i === options.length - 1}
          />
        ))}
      </Group>
    </SubScreen>
  );
}
