// Bottom tab bar — edge-to-edge, hairline dark top border, no
// active background pill. Just a tint + label-weight swap on the
// focused tab. Icons use the brand SVGs from src/ui/icons.ts so we
// keep one icon set across nav + auth.

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { Icon, Icons, Text } from '@/ui';

const PAL = {
  bg:         '#0D0D0D',
  topBorder:  'rgba(255, 255, 255, 0.10)',  // "dark grey" per spec
  iconActive: '#FFFFFF',
  iconIdle:   'rgba(255, 255, 255, 0.35)',
  labelActive:'#FFFFFF',
  labelIdle:  'rgba(255, 255, 255, 0.45)',
} as const;

const VISIBLE = ['index', 'transactions', 'settings'] as const;

const ICON_BY_ROUTE: Record<string, string> = {
  index:        Icons.IconHome,
  transactions: Icons.IconBill,
  settings:     Icons.IconSetting,
};

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const visibleRoutes = state.routes.filter((r) =>
    (VISIBLE as readonly string[]).includes(r.name),
  );
  const activeName = state.routes[state.index]?.name;

  return (
    <View style={[s.bar, { paddingBottom: Math.max(8, insets.bottom) }]}>
      <View style={s.row}>
        {visibleRoutes.map((route) => {
          const desc = descriptors[route.key];
          if (!desc) return null;
          const isFocused = activeName === route.name;
          const label = (desc.options.title ?? route.name) as string;
          const xml = ICON_BY_ROUTE[route.name];

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={s.tab}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
            >
              {xml ? (
                <Icon
                  xml={xml}
                  size={24}
                  color={isFocused ? PAL.iconActive : PAL.iconIdle}
                />
              ) : null}
              <Text
                style={[
                  s.label,
                  { color: isFocused ? PAL.labelActive : PAL.labelIdle },
                  isFocused && s.labelActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    backgroundColor: PAL.bg,
    borderTopWidth: 1,
    borderTopColor: PAL.topBorder,
  },
  row: {
    flexDirection: 'row',
    paddingTop: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 11,
  },
  labelActive: {
    fontFamily: 'BricolageGrotesque-SemiBold',
  },
});
