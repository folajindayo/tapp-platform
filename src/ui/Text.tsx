import { Text as RnText, type TextProps as RnTextProps } from 'react-native';

type Variant =
  | 'titleLarge'
  | 'titleMedium'
  | 'body'
  | 'bodyMuted'
  | 'caption'
  | 'label'
  | 'button'
  | 'amount';

// Base NativeWind classes for each variant — user className appended after and wins
const variantClasses: Record<Variant, string> = {
  titleLarge:  'text-[28px] font-bold leading-[34px] text-ink',
  titleMedium: 'text-xl font-bold leading-6 text-ink',
  body:        'text-base font-sans text-ink',
  bodyMuted:   'text-base font-sans text-muted-text',
  caption:     'text-sm font-sans text-muted-text',
  label:       'text-xs font-medium text-muted-section uppercase tracking-[0.6px]',
  button:      'text-base font-sans text-center text-surface',
  amount:      'text-[56px] font-semibold leading-[64px] text-ink',
};

// fontVariant can't be expressed in NativeWind — keep as inline style for amount
const variantStyle: Partial<Record<Variant, object>> = {
  amount: { fontVariant: ['tabular-nums'] },
};

export interface TextProps extends RnTextProps {
  variant?: Variant;
  className?: string;
}

export function Text({ variant = 'body', className, style, ...rest }: TextProps) {
  return (
    <RnText
      className={`${variantClasses[variant]}${className ? ` ${className}` : ''}`}
      style={[variantStyle[variant], style]}
      {...rest}
    />
  );
}
