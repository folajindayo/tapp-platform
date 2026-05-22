import { type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { cssInterop } from 'nativewind';

cssInterop(SafeAreaView, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

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
 */
export function Screen({
  children,
  className,
  contentContainerClassName,
  scrollable = true,
  edges = ['top', 'left', 'right'],
}: ScreenProps) {
  return (
    <SafeAreaView edges={edges} className={`flex-1 bg-surface ${className ?? ''}`}>
      {scrollable ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={`px-5 py-4 ${contentContainerClassName ?? ''}`}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View className={`flex-1 px-5 py-4 ${contentContainerClassName ?? ''}`}>{children}</View>
      )}
    </SafeAreaView>
  );
}
