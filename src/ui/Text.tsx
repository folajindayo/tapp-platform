import { Text as RnText, type TextProps as RnTextProps, type TextStyle } from 'react-native';
import { typography } from './theme';

type Variant =
  | 'titleLarge'
  | 'titleMedium'
  | 'body'
  | 'bodyMuted'
  | 'caption'
  | 'label'
  | 'button'
  | 'amount';

export interface TextProps extends RnTextProps {
  variant?: Variant;
  style?: TextStyle | TextStyle[];
}

/**
 * Themed Text. Always picks a variant from the typography scale unless
 * overridden via `style`. Use `style` for one-off color tweaks; don't
 * change font sizes ad-hoc — add a variant to the scale instead.
 */
export function Text({ variant = 'body', style, ...rest }: TextProps) {
  return <RnText style={[typography[variant], style]} {...rest} />;
}
