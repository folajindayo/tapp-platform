import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { catalogApi, merchantApi, verifyApi } from '@/api/endpoints';
import { Check, ChevronDown, ChevronLeft, Landmark, Search, X } from 'lucide-react-native';
import { Button, toast } from '@/ui';
import { theme } from '@/ui/theme';

const CURRENCY = 'NGN';
const { height: SCREEN_H } = Dimensions.get('window');

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  bg: theme.colors.black,
  card: theme.colors.surface,
  cardBorder: theme.colors.border,
  field: theme.colors.surfaceSubtle,
  fieldBorder: theme.colors.borderStrong,
  focus: theme.colors.brand,
  white: '#FFFFFF',
  textPrimary: theme.colors.textStrong,
  textSecondary: theme.colors.textSecondary,
  textPlaceholder: theme.colors.textSubtle,
  accent: theme.colors.brand,
  accentSoft: 'rgba(41, 141, 255, 0.12)',
  green: theme.colors.success,
  greenSoft: theme.colors.successBg,
  red: theme.colors.danger,
  divider: theme.colors.border,
  overlay: 'rgba(0,0,0,0.70)',
  sheet: theme.colors.surface,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
export default function BankAccountScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const queryClient = useQueryClient();

  const institutionsQ = useQuery({
    queryKey: ['catalog', 'institutions', CURRENCY],
    queryFn: () => catalogApi.institutions(CURRENCY),
  });
  const banks = institutionsQ.data ?? [];

  const [bankCode, setBankCode] = useState<string | null>(null);
  const [acctNum, setAcctNum] = useState('');
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const selectedBank = useMemo(
    () => banks.find((b) => b.code === bankCode) ?? null,
    [banks, bankCode],
  );

  // ── Auto-verify ────────────────────────────────────────────────────────────
  useEffect(() => {
    setResolvedName(null);
    setError(null);
    if (!bankCode || acctNum.length !== 10) return;
    const t = setTimeout(async () => {
      setResolving(true);
      try {
        const name = await verifyApi.account({
          institution: bankCode,
          account_identifier: acctNum,
          currency: CURRENCY,
        });
        setResolvedName(name);
      } catch (e) {
        setError((e as { message?: string })?.message ?? 'Could not verify');
      } finally {
        setResolving(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [bankCode, acctNum]);

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!bankCode || !resolvedName || acctNum.length !== 10) return;
    setSaving(true);
    try {
      await merchantApi.saveBankAccount({
        currency: CURRENCY,
        bank_code: bankCode,
        account_number: acctNum,
        account_name: resolvedName,
      });
      await queryClient.invalidateQueries({ queryKey: ['merchant', 'bank-account'] });
      toast.success('Payout account saved successfully');
      if (from === 'settings') {
        router.replace('/(app)/settings');
      } else {
        router.replace('/(app)');
      }
    } catch (e) {
      Alert.alert('Error', (e as { message?: string })?.message ?? 'Try again');
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!resolvedName && !resolving && !saving;

  function goBack() {
    if (from === 'settings') {
      router.replace('/(app)/settings');
    } else {
      if (router.canGoBack()) router.back();
      else router.replace('/(onboarding)/kyb');
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={$.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={$.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={$.flex}
          contentContainerStyle={$.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Top bar ─────────────────────────────────── */}
          <View style={$.topBar}>
            <Pressable onPress={goBack} hitSlop={14} style={$.backCircle}>
              <ChevronLeft size={20} color={C.textPrimary} />
            </Pressable>
            <View style={$.dots}>
              <View style={[$.dot, $.dotDone]} />
              <View style={[$.dot, $.dotDone]} />
              <View style={[$.dot, $.dotDone]} />
              <View style={[$.dot, $.dotActive]} />
            </View>
            <View style={{ width: 36 }} />
          </View>

          {/* ── Title ───────────────────────────────────── */}
          <Text style={$.heading}>Where should we{"\n"}send your money?</Text>
          <Text style={$.subheading}>
            Bank payouts settle in NGN to this account.
          </Text>

          {/* ── Card ────────────────────────────────────── */}
          <View>
            {/* Bank selector */}
            <View style={$.fieldWrap}>
              <Text style={$.fieldLabel}>Bank</Text>
              <Pressable
                onPress={() => setShowPicker(true)}
                style={({ pressed }) => [
                  $.selectField,
                  showPicker && $.selectFieldFocused,
                  pressed && $.selectFieldPressed,
                ]}
                className="flex !px-4 !py-6 bg-[#1E1E1E] rounded-[14px] flex-row w-full justify-between items-center"
              >
                <View style={$.selectFieldLeft}>
                  <Landmark
                    size={20}
                    color={selectedBank ? C.accent : C.textPlaceholder}
                  />
                  <Text
                    style={[
                      $.selectText,
                      !selectedBank && $.selectTextPlaceholder,
                    ]}
                  >
                    {selectedBank ? selectedBank.name : "Tap to choose a bank"}
                  </Text>
                </View>
                <View className="right-8">
                  <ChevronDown
                    size={20}
                    color={C.textSecondary}
                  />
                </View>
              </Pressable>
            </View>

            {/* Account number */}
            <View style={$.fieldWrap}>
              <View style={$.fieldLabelRow}>
                <Text style={$.fieldLabel}>Account Number</Text>
                <Text style={$.charCount}>{acctNum.length}/10</Text>
              </View>
              <View style={[$.inputField, inputFocused && $.inputFieldFocused]}>
                <TextInput
                  value={acctNum}
                  onChangeText={(t) =>
                    setAcctNum(t.replace(/[^0-9]/g, "").slice(0, 10))
                  }
                  placeholder="Enter 10-digit NUBAN"
                  placeholderTextColor={C.textPlaceholder}
                  keyboardType="number-pad"
                  maxLength={10}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  style={$.inputText}
                  autoCorrect={false}
                />
              </View>

              {/* Verification status */}
              {resolving && (
                <View style={$.statusRow}>
                  <ActivityIndicator size="small" color={C.textSecondary} />
                  <Text style={$.statusLabel}>Verifying account…</Text>
                </View>
              )}
              {!resolving && resolvedName && (
                <View style={$.verifiedBadge}>
                  <Check size={14} color={C.green} strokeWidth={3} />
                  <Text style={$.verifiedName} numberOfLines={1}>
                    {resolvedName}
                  </Text>
                </View>
              )}
              {!resolving && error && <Text style={$.errorLabel}>{error}</Text>}
            </View>
          </View>

          {/* Actions */}
          <View style={{ flexDirection: "row", gap: 16, marginTop: 24 }}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="secondary" onPress={goBack} />
            </View>
            <View style={{ flex: 1.4 }}>
              <Button
                label="Save"
                onPress={handleSave}
                disabled={!canSave}
                loading={saving}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Bank Picker ───────────────────────────────── */}
      <BankPickerSheet
        visible={showPicker}
        banks={banks}
        loading={institutionsQ.isLoading}
        selected={bankCode}
        onPick={(code) => {
          setBankCode(code);
          setShowPicker(false);
          setAcctNum("");
          setResolvedName(null);
        }}
        onClose={() => setShowPicker(false)}
      />
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Bank Picker Sheet
// ═══════════════════════════════════════════════════════════════════════════════
function BankPickerSheet({
  visible,
  banks,
  loading,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  banks: { code: string; name: string }[];
  loading: boolean;
  selected: string | null;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const low = q.trim().toLowerCase();
    if (!low) return banks;
    return banks.filter((b) => b.name.toLowerCase().includes(low));
  }, [q, banks]);

  function pick(code: string) {
    setQ('');
    onPick(code);
  }
  function close() {
    setQ('');
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={m.backdrop}>
        <Pressable style={m.backdropTouch} onPress={close} />

        <View style={m.sheet}>
          {/* Handle bar */}
          <View style={m.handleBar} />

          {/* Header */}
          <View style={m.header}>
            <Text style={m.headerTitle}>Select Bank</Text>
            <Pressable onPress={close} hitSlop={12} style={m.closeCircle}>
              <X size={16} color={C.textSecondary} />
            </Pressable>
          </View>

          {/* Search */}
          <View style={m.searchRow}>
            <Search size={18} color={C.textPlaceholder} style={{ marginRight: 2 }} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search banks…"
              placeholderTextColor={C.textPlaceholder}
              autoCorrect={false}
              autoCapitalize="none"
              style={m.searchInput}
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ('')} hitSlop={8}>
                <X size={16} color={C.textSecondary} />
              </Pressable>
            )}
          </View>

          {/* Bank list */}
          {loading ? (
            <View style={m.centered}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={m.centered}>
              <Text style={m.emptyText}>No banks found</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(b) => b.code}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
              contentContainerStyle={m.listContent}
              renderItem={({ item }) => {
                const active = item.code === selected;
                return (
                  <Pressable
                    onPress={() => pick(item.code)}
                    style={({ pressed }) => [
                      m.bankRow,
                      pressed && m.bankRowPressed,
                      active && m.bankRowActive,
                    ]}
                    className='flex flex-row justify-between w-full items-center'
                  >
                    <View className='p-2'>
                      <Text
                        style={[m.bankName, active && m.bankNameActive]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                    </View>
                    {active && <Check size={18} color={C.accent} strokeWidth={2.5} />}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Styles
// ═══════════════════════════════════════════════════════════════════════════════
const $ = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 48 },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    marginBottom: 28,
  },
  backCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 22,
    color: C.textPrimary,
    marginTop: -2,
  },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dotDone: { backgroundColor: 'rgba(41, 141, 255, 0.4)' },
  dotActive: { backgroundColor: C.accent },

  // Title
  heading: {
    fontFamily: theme.fontFamilies.display,
    fontSize: 28,
    color: C.textPrimary,
    lineHeight: 36,
    marginBottom: 8,
  },
  subheading: {
    fontFamily: theme.fontFamilies.text,
    fontSize: 15,
    color: C.textSecondary,
    lineHeight: 22,
    marginBottom: 28,
  },

  // Card
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingHorizontal: 18,
    paddingVertical: 22,
  },

  // Field
  fieldWrap: { gap: 10 },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  fieldLabel: {
    fontFamily: theme.fontFamilies.textMedium,
    fontSize: 13,
    color: C.textSecondary,
    // textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  charCount: {
    fontFamily: theme.fontFamilies.text,
    fontSize: 12,
    color: C.textPlaceholder,
  },

  selectField: {
    height: 56,
    backgroundColor: C.field,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.fieldBorder,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectFieldPressed: { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
  selectFieldFocused: { borderColor: C.focus },
  selectFieldLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectText: {
    flex: 1,
    minWidth: 0,         // RN flex quirk: lets the text shrink instead of growing to content
    flexShrink: 1,
    fontFamily: theme.fontFamilies.textMedium,
    fontSize: 16,
    color: C.textPrimary,
    marginRight: 8,
  },
  selectTextPlaceholder: {
    fontFamily: theme.fontFamilies.text,
    color: C.textSecondary,
  },
  chevron: {
    fontSize: 18,
    color: C.textSecondary,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: C.divider,
    marginVertical: 20,
  },

  // Input
  inputField: {
    height: 56,
    backgroundColor: C.field,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.fieldBorder,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  inputFieldFocused: { borderColor: C.focus },
  inputText: {
    fontFamily: theme.fontFamilies.textMedium,
    fontSize: 16,
    color: C.textPrimary,
    padding: 0,
  },

  // Verification status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  statusLabel: {
    fontFamily: theme.fontFamilies.text,
    fontSize: 13,
    color: C.textSecondary,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.greenSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  verifiedCheck: { fontSize: 13, color: C.green },
  verifiedName: {
    fontFamily: theme.fontFamilies.displayMedium,
    fontSize: 13,
    color: C.green,
    maxWidth: 200,
  },
  errorLabel: {
    fontFamily: theme.fontFamilies.text,
    fontSize: 13,
    color: C.red,
    marginTop: 4,
  },

});

// ─── Modal styles ────────────────────────────────────────────────────────────
const SHEET_H = SCREEN_H * 0.72;

const m = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    height: SHEET_H,
    backgroundColor: C.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  handleBar: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#444',
    marginTop: 10,
    marginBottom: 12,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerTitle: {
    fontFamily: theme.fontFamilies.textBold,
    fontSize: 20,
    color: C.textPrimary,
  },
  closeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeX: { fontSize: 14, color: C.textSecondary },

  // Search
  searchRow: {
    marginHorizontal: 20,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
    marginBottom: 8,
  },
  searchIcon: { fontSize: 14 },
  searchInput: {
    flex: 1,
    fontFamily: theme.fontFamilies.text,
    fontSize: 15,
    color: C.textPrimary,
    padding: 0,
  },
  clearX: { fontSize: 13, color: C.textSecondary },

  // List
  centered: {
    paddingVertical: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: theme.fontFamilies.text,
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 6,
  },

  // Row
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
  },
  bankRowPressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  bankRowActive: { backgroundColor: C.accentSoft },
  bankInitial: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textSecondary,
  },
  bankInitialActive: { color: C.accent },
  bankName: {
    flex: 1,
    fontFamily: theme.fontFamilies.textMedium,
    fontSize: 15,
    color: C.textPrimary,
  },
  bankNameActive: {
    fontFamily: theme.fontFamilies.displayMedium,
    color: C.accent,
  },
  checkMark: {
    fontSize: 16,
    fontWeight: '700',
    color: C.accent,
  },
});
