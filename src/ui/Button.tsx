import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  TouchableOpacity,
  View,
  type TouchableOpacityProps,
} from 'react-native';
import { cssInterop } from 'nativewind';
import { Text } from './Text';

cssInterop(TouchableOpacity, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<TouchableOpacityProps, 'children' | 'style'> {
  /** Button label. */
  label: string;
  /** Visual variant. Defaults to primary (brand-green pill). */
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
  primary: 'bg-brand-green active:opacity-90',
  secondary: 'bg-surface active:bg-surface-subtle border border-line-muted',
  ghost: 'bg-transparent active:bg-surface-subtle',
  danger: 'bg-danger active:opacity-90',
};

const textByVariant: Record<ButtonVariant, string> = {
  primary: 'text-ink-true',
  secondary: 'text-ink',
  ghost: 'text-ink',
  danger: 'text-white',
};

/**
 * Primary CTA matches users-app: 59px tall, pill-radius, brand-green
 * background with near-black label. Secondary is a soft white surface
 * with a subtle border.
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
    ...rest
  },
  ref,
) {
  const isDisabled = !!disabled || !!loading;
  const containerClasses = `${containerByVariant[variant]} h-[59px] px-5 rounded-pill flex-row items-center justify-center gap-2 ${isDisabled ? 'opacity-50' : ''} ${className ?? ''}`;
  const labelClasses = `text-base font-medium ${textByVariant[variant]}`;
  const spinnerColor = variant === 'primary' || variant === 'danger' ? '#000000' : '#121212';

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
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <>
          {leadingIcon}
          <Text className={labelClasses}>{label}</Text>
          {trailingIcon}
        </>
      )}
    </TouchableOpacity>
  );
});
