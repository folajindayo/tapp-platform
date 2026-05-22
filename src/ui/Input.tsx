import { forwardRef } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { cssInterop } from 'nativewind';
import { Text } from './Text';

cssInterop(TextInput, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  className?: string;
}

/**
 * Labeled text field. Visual style mirrors users-app: white surface with a
 * soft border, generous height for finger targets, label sits above and
 * is tinted as a section header.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, className, ...rest },
  ref,
) {
  return (
    <View className="w-full">
      {label ? (
        <Text className="text-sm font-medium text-ink-700 mb-2">{label}</Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor="#9A9A9A"
        accessibilityLabel={label}
        className={`h-[59px] rounded-lg px-4 text-base text-ink bg-surface border ${error ? 'border-danger' : 'border-line-muted'} ${className ?? ''}`}
        {...rest}
      />
      {error ? (
        <Text className="text-xs text-danger mt-1.5">{error}</Text>
      ) : hint ? (
        <Text className="text-xs text-muted-subtle mt-1.5">{hint}</Text>
      ) : null}
    </View>
  );
});
