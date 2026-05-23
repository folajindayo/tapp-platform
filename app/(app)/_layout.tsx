import { Pressable, View } from "react-native";
import { Tabs } from "expo-router";
import { ClockIcon, Home, UserCircle2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cssInterop } from "nativewind";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { colors } from "@/ui/theme";

cssInterop(Pressable, { className: { target: "style" } });
cssInterop(View, { className: { target: "style" } });

const TABS = [
  { name: "index", label: "Charge", Icon: Home },
  { name: "transactions", label: "History", Icon: ClockIcon },
  { name: "settings", label: "Account", Icon: UserCircle2 },
];

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: "Charge" }} />
      <Tabs.Screen name="transactions" options={{ title: "History" }} />
      <Tabs.Screen name="settings" options={{ title: "Account" }} />
      <Tabs.Screen name="new-payment" options={{ href: null }} />
      <Tabs.Screen name="broadcast" options={{ href: null }} />
      <Tabs.Screen name="tap-card" options={{ href: null }} />
      <Tabs.Screen name="change-password" options={{ href: null }} />
    </Tabs>
  );
}

function TabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <View
      className="absolute bottom-0 left-0 right-0 items-center"
      pointerEvents="box-none"
    >
      <View className="w-full flex-row bg-surface-bg items-center justify-between px-[28px] py-[20px] border border-t-white/10">
        {TABS.map((tab, index) => {
          const focused = state.index === index;

          return (
            <Pressable
              key={tab.name}
              className="items-center justify-between gap-[7px]"
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: state.routes[index]?.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(tab.name);
                }
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
            >
              {/* Active indicator bar */}
              <tab.Icon
                size={22}
                color={focused ? colors.brand : colors.textInactive}
                strokeWidth={focused ? 2.2 : 1.6}
              />
              <View
                className="rounded-[2px]"
                style={{
                  width: focused ? 28 : 0,
                  height: 3,
                  backgroundColor: focused ? colors.brand : "transparent",
                }}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
