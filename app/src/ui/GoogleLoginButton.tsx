import { Image, Pressable, StyleSheet } from 'react-native';

// Unmodified pre-approved Google asset. Source and usage: docs/social-login.md.
export function GoogleLoginButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress} style={[styles.button, { opacity: busy ? 0.5 : 1 }]}>
      <Image source={require('../../assets/google-signin-light.png')} resizeMode="contain" style={styles.image} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: { height: 54, alignItems: 'center', justifyContent: 'center', marginVertical: 6 },
  image: { width: '100%', height: 54 },
});
