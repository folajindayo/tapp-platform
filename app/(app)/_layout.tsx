import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';
import { PaymentsRealtimeProvider } from '@/realtime/PaymentsRealtimeProvider';

export default function AppLayout() {
  return (
    <PaymentsRealtimeProvider>
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
        }}
      />
      {/* Non-tab routes — hidden from the tab bar */}
      <Tabs.Screen name="new-payment" options={{ href: null }} />
      <Tabs.Screen name="broadcast" options={{ href: null }} />
      <Tabs.Screen name="tap-card" options={{ href: null }} />
      <Tabs.Screen name="accept" options={{ href: null }} />
    </Tabs>
    </PaymentsRealtimeProvider>
  );
}
