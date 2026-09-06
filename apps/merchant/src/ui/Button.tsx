import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  TouchableOpacity,
  View,
  type TouchableOpacityProps,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { cssInterop } from 'nativewind';
import { Text } from './Text';

cssInterop(TouchableOpacity, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<TouchableOpacityProps, 'children' | 'style'> {
  /** Button label. */
  label: string;
  /** Visual variant. Defaults to primary (brand rounded-xl). */
  variant?: ButtonVariant;
  /** Show a centered spinner instead of the label and prevent presses. */
  loading?: boolean;
  /** Optional leading icon (rendered to the left of the label). */
  leadingIcon?: ReactNode;
  /** Optional trailing icon (rendered to the right of the label). */
  trailingIcon?: ReactNode;
  /** Extra Tailwind classes applied to the container. */
  className?: string;
}

const containerByVariant: Record<ButtonVariant, string> = {
  primary: 'bg-brand active:opacity-90',
  secondary: 'bg-surface active:bg-surface-subtle border border-line-muted',
  ghost: 'bg-transparent active:bg-surface-subtle',
  danger: 'bg-danger active:opacity-90',
};

const textByVariant: Record<ButtonVariant, string> = {
  primary: 'text-white',
  secondary: 'text-ink',
  ghost: 'text-ink',
  danger: 'text-white',
};

/**
 * CTA primitive. Visual style matches users-app (tapp):
 * 52px tall, rounded-xl (12px) corners, brand background.
 * Secondary is a surface with a subtle border.
 */
export const Button = forwardRef<View, ButtonProps>(function Button(
  {
    label,
    variant = 'primary',
    loading,
    leadingIcon,
    trailingIcon,
    disabled,
    className,
    accessibilityLabel,
    accessibilityHint,
    onPress,
    ...rest
  },
  ref,
) {
  const isDisabled = !!disabled || !!loading;
  const containerClasses = `${containerByVariant[variant]} h-[52px] px-5 rounded-xl flex-row items-center justify-center gap-2 ${isDisabled ? 'opacity-50' : ''} ${className ?? ''}`;
  const labelClasses = `text-base font-semibold ${textByVariant[variant]}`;
  const spinnerColor = variant === 'primary' || variant === 'danger' ? '#FFFFFF' : '#FAFAFA';

  const handlePress = (e: any) => {
    if (isDisabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onPress) {
      onPress(e);
    }
  };

  return (
    <TouchableOpacity
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      activeOpacity={0.8}
      disabled={isDisabled}
      className={containerClasses}
      onPress={handlePress}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <>
          {leadingIcon}
          {label ? <Text className={labelClasses}>{label}</Text> : null}
          {trailingIcon}
        </>
      )}
    </TouchableOpacity>
  );
});
