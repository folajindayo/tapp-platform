import React, { useState } from 'react';
import { View, Pressable, StyleSheet, useColorScheme } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Home, Receipt, Settings } from 'lucide-react-native';
import { cssInterop } from 'nativewind';
import { Text } from '@/ui';

cssInterop(Pressable, { className: { target: 'style' } });
cssInterop(View, { className: { target: 'style' } });

// Spring preset matching SPRINGS.default in tapp:
// mass: 0.6, damping: 18, stiffness: 220
const SPRING_CONFIG = {
  mass: 0.6,
  damping: 18,
  stiffness: 220,
};

// Tight spring for click scale feedback:
// mass: 0.4, damping: 22, stiffness: 320
const TIGHT_SPRING = {
  mass: 0.4,
  damping: 22,
  stiffness: 320,
};

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  // Filter only main tab routes
  const visibleRoutes = state.routes.filter((route) =>
    ['index', 'transactions', 'settings'].includes(route.name)
  );

  const activeRouteName = state.routes[state.index]?.name;
  const activeIndex = visibleRoutes.findIndex(
    (route) => activeRouteName === route.name
  );

  // Track layout coordinates to drive the sliding capsule animation
  const [tabLayouts, setTabLayouts] = useState<Array<{ x: number; width: number }>>([]);
  
  const capsuleLeft = useSharedValue(0);
  const capsuleWidth = useSharedValue(0);

  React.useEffect(() => {
    if (tabLayouts[activeIndex]) {
      const { x, width } = tabLayouts[activeIndex];
      capsuleLeft.value = withSpring(x, SPRING_CONFIG);
      capsuleWidth.value = withSpring(width, SPRING_CONFIG);
    }
  }, [activeIndex, tabLayouts, capsuleLeft, capsuleWidth]);

  const handleTabLayout = (index: number, x: number, width: number) => {
    setTabLayouts((prev) => {
      const next = [...prev];
      next[index] = { x, width };
      return next;
    });
  };

  const animatedCapsuleStyle = useAnimatedStyle(() => ({
    left: capsuleLeft.value,
    width: capsuleWidth.value,
  }));

  return (
    <View
      className="absolute bottom-[max(20px,env(safe-area-inset-bottom))] left-5 right-5 h-[68px] bg-white/90 dark:bg-neutral-900/90 border border-line-divider/60 dark:border-white/10 rounded-[24px] flex-row items-center justify-between px-3 shadow-[0_8px_30px_rgb(0,0,0,0.06)]"
      style={{
        backdropFilter: 'blur(10px)',
      }}
    >
      {/* Sliding Background Capsule */}
      {tabLayouts.length === visibleRoutes.length && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            animatedCapsuleStyle,
            {
              top: 8,
              bottom: 8,
              borderRadius: 16,
              backgroundColor: isDark ? 'rgba(0, 101, 245, 0.15)' : '#EBF3FF',
              position: 'absolute',
              zIndex: 0,
            },
          ]}
        />
      )}

      {visibleRoutes.map((route, index) => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const { options } = descriptor;
        const label =
          options.tabBarLabel !== undefined
            ? options.tabBarLabel
            : options.title !== undefined
            ? options.title
            : route.name;

        const isFocused = state.routes[state.index]?.name === route.name;

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

        const onLongPress = () => {
          navigation.emit({
            type: 'tabLongPress',
            target: route.key,
          });
        };

        // Render matching icon
        const renderIcon = (color: string) => {
          const iconSize = 22;
          switch (route.name) {
            case 'index':
              return <Home size={iconSize} color={color} strokeWidth={2.2} />;
            case 'transactions':
              return <Receipt size={iconSize} color={color} strokeWidth={2.2} />;
            case 'settings':
              return <Settings size={iconSize} color={color} strokeWidth={2.2} />;
            default:
              return null;
          }
        };

        // Icon colors matching tapp theme
        const activeColor = '#0065F5';
        const inactiveColor = isDark ? 'rgba(255, 255, 255, 0.4)' : '#8E919A';
        const iconColor = isFocused ? activeColor : inactiveColor;
        const textColorClass = isFocused 
          ? 'text-brand-blue font-semibold' 
          : 'text-muted-text dark:text-white/40 font-medium';

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={(options as any).tabBarTestID}
            onPress={onPress}
            onLongPress={onLongPress}
            onLayout={(e) => {
              const { x, width } = e.nativeEvent.layout;
              handleTabLayout(index, x, width);
            }}
            className="flex-1 items-center justify-center py-2 h-full z-10"
          >
            <TabItemContainer isFocused={isFocused}>
              <View className="items-center gap-1">
                {renderIcon(iconColor)}
                <Text className={`text-[11px] leading-none ${textColorClass}`}>
                  {label as string}
                </Text>
              </View>
            </TabItemContainer>
          </Pressable>
        );
      })}
    </View>
  );
}

// Inner container that does a subtle scale down when tapped
function TabItemContainer({
  children,
  isFocused,
}: {
  children: React.ReactNode;
  isFocused: boolean;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = () => {
    scale.value = withSpring(0.92, TIGHT_SPRING);
  };

  const onPressOut = () => {
    scale.value = withSpring(1, SPRING_CONFIG);
  };

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      className="items-center justify-center w-full h-full"
    >
      <Animated.View style={[animatedStyle, { alignItems: 'center' }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
