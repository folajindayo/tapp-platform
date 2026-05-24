import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

interface ScreenProps {
  children: ReactNode;
  className?: string;
  contentContainerClassName?: string;
  scrollable?: boolean;
  edges?: Edge[];
}

/**
 * Root container for every screen. Picks up safe-area insets and gives
 * the content a consistent 20px horizontal padding (matches users-app's
 * spacing scale).
 *
 * Uses inline styles so layout works regardless of NativeWind compilation
 * status (Expo Go / dev-client mismatch). NativeWind className is layered
 * on top when available.
 */
export function Screen({
  children,
  className,
  contentContainerClassName,
  scrollable = true,
  edges = ['top', 'left', 'right'],
}: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={styles.root} className={className}>
      {scrollable ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          contentContainerClassName={contentContainerClassName}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.content]} className={contentContainerClassName}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
});

