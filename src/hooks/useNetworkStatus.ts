// Network status hook. STUB for now — always returns 'good'.
//
// To wire real connectivity:
//   1. expo install @react-native-community/netinfo
//   2. Rebuild the dev-client (npx expo run:ios)
//   3. Swap the stub below for:
//        import NetInfo from '@react-native-community/netinfo';
//        const [state, setState] = useState<NetInfoState | null>(null);
//        useEffect(() => NetInfo.addEventListener(setState), []);
//        return derive(state);
//
// Status mapping the dashboard expects:
//   'good' → IconWifiGood    (online, fast)
//   'weak' → IconWifiWeak    (online but slow / cellular only)
//   'off'  → IconWifiOff     (no connectivity)

export type NetworkStatus = 'good' | 'weak' | 'off';

export function useNetworkStatus(): NetworkStatus {
  return 'good';
}
