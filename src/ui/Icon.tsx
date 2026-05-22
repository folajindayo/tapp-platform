import { memo } from 'react';
import { View, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { cssInterop } from 'nativewind';

cssInterop(View, { className: { target: 'style' } });

export interface IconProps {
  xml: string;
  size?: number;
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  style?: ViewStyle;
}

/**
 * Renders a brand SVG (XML string from src/ui/icons.ts).
 *
 * `color` recolors any `currentColor` references inside the XML — if you want
 * a tint applied, the source XML must use `currentColor` for its strokes/fills.
 * Most ported icons have hard-coded brand colors (intentional), so omit `color`
 * to keep them as designed.
 */
export const Icon = memo(function Icon({
  xml,
  size = 24,
  width,
  height,
  color,
  className,
  style,
}: IconProps) {
  return (
    <View className={className} style={style}>
      <SvgXml
        xml={xml}
        width={width ?? size}
        height={height ?? size}
        color={color}
      />
    </View>
  );
});
