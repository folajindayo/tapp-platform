import { forwardRef, useState } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { cssInterop } from 'nativewind';
import { Eye, EyeOff } from 'lucide-react-native';
import { Text } from './Text';
import { colors } from './theme';

// Only apply NativeWind to the wrapper View, NOT to the inner TextInput.
// Applying cssInterop to TextInput lets NativeWind inject styles that can
// conflict with our explicit background override.
cssInterop(View, { className: { target: 'style' } });

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  wrapperStyle?: StyleProp<ViewStyle>;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    hint,
    wrapperStyle,
    onFocus,
    onBlur,
    secureTextEntry,
    style,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);

  const isPassword = secureTextEntry === true;

  const borderColor = error
    ? colors.brand
    : focused
    ? colors.brand
    : colors.borderMuted;

  return (
    <View style={[{ width: '100%' }, wrapperStyle]}>
      {label ? (
        <Text className="text-sm font-medium text-ink-700 mb-2">{label}</Text>
      ) : null}

      <View
        style={{
          height: 54,
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 12,
          borderWidth: 2,
          borderColor,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        }}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
          secureTextEntry={isPassword && !visible}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
          // These must come AFTER {...rest} so callers cannot accidentally
          // re-enable autofill or the composing-text background.
          autoComplete="off"
          autoCorrect={false}
          spellCheck={false}
          // disableFullscreenUI prevents the IME from taking over the view
          // in landscape, which also suppresses some keyboard highlight layers.
          disableFullscreenUI
          underlineColorAndroid="transparent"
          // importantForAutofill="no" tells the Android AutofillManager to
          // skip this view, removing the yellow/orange autofill highlight.
          importantForAutofill="no"
          style={[
            {
              flex: 1,
              height: '100%',
              paddingHorizontal: 16,
              fontSize: 16,
              fontFamily: 'BricolageGrotesque-Regular',
              color: colors.text,
              backgroundColor: colors.surface,
            },
            style,
          ]}
        />

        {isPassword ? (
          <Pressable
            onPress={() => setVisible((v) => !v)}
            hitSlop={8}
            style={{ paddingRight: 16 }}
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          >
            {visible
              ? <EyeOff size={20} color={colors.textMuted} />
              : <Eye size={20} color={colors.textMuted} />}
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text className="text-xs text-brand mt-1.5">{error}</Text>
      ) : hint ? (
        <Text className="text-xs text-muted-subtle mt-1.5">{hint}</Text>
      ) : null}
    </View>
  );
});
