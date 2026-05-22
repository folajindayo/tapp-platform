import { type ReactNode } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import { Text } from './Text';

cssInterop(TouchableOpacity, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

export interface HeaderProps {
  title?: string;
  back?: boolean;
  right?: ReactNode;
  onBack?: () => void;
}

/**
 * Page-level header used on full-screen routes. Title is centered across
 * the row; back chevron lives in the left slot.
 */
export function Header({ title, back = true, right, onBack }: HeaderProps) {
  const handleBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return (
    <View className="h-12 flex-row items-center justify-between mb-4">
      <View className="w-12">
        {back ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
            onPress={handleBack}
            className="h-10 w-10 items-center justify-center rounded-md"
          >
            <ArrowLeft size={22} color="#121212" />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text className="text-base font-semibold text-ink" numberOfLines={1}>
        {title ?? ''}
      </Text>
      <View className="w-12 items-end">{right}</View>
    </View>
  );
}
