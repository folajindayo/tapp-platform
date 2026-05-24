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
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { catalogApi, merchantApi, verifyApi } from '@/api/endpoints';
import { ChevronDown } from 'lucide-react-native';
import { Button } from '@/ui';

const CURRENCY = 'NGN';
const { height: SCREEN_H } = Dimensions.get('window');

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#0A0A0C',
  card: '#141416',
  cardBorder: 'rgba(255,255,255,0.06)',
  field: '#1B1B1F',
  fieldBorder: 'rgba(255,255,255,0.08)',
  focus: '#3B82F6',
  white: '#FFFFFF',
  textPrimary: '#F5F5F7',
  textSecondary: 'rgba(255,255,255,0.60)',
  textPlaceholder: 'rgba(255,255,255,0.35)',
  accent: '#3B82F6',
  accentSoft: 'rgba(59,130,246,0.15)',
  green: '#34D399',
  greenSoft: 'rgba(52,211,153,0.12)',
  red: '#FB7185',
  divider: 'rgba(255,255,255,0.05)',
  overlay: 'rgba(0,0,0,0.60)',
  sheet: '#1C1C1E',
} as const;

// ═════════════════════════════════════════════════════════════════════════════
export default function BankAccountScreen() {
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
    } catch (e) {
      Alert.alert('Error', (e as { message?: string })?.message ?? 'Try again');
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!resolvedName && !resolving && !saving;

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(onboarding)/kyb');
  }

  // ═════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={$.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={$.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
              <Text style={$.backArrow}>‹</Text>
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
          <Text style={$.heading}>Where should we{'\n'}send your money?</Text>
          <Text style={$.subheading}>
            Bank payouts settle in NGN to this account.
          </Text>

          {/* ── Card ────────────────────────────────────── */}
          <View style={$.card}>
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
              >
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[
                    $.selectText,
                    !selectedBank && $.selectTextPlaceholder,
                  ]}
                >
                  {selectedBank ? selectedBank.name : 'Tap to choose a bank'}
                </Text>
                {/* Wrap the chevron in a flex-shrink:0 box so the long
                    bank name truncates with ellipsis instead of pushing
                    the icon out of the row. */}
                <View style={$.selectChevron}>
                  <ChevronDown size={20} color={C.textSecondary} />
                </View>
              </Pressable>
            </View>

            {/* Divider */}
            <View style={$.divider} />

            {/* Account number */}
            <View style={$.fieldWrap}>
              <View style={$.fieldLabelRow}>
                <Text style={$.fieldLabel}>Account Number</Text>
                <Text style={$.charCount}>{acctNum.length}/10</Text>
              </View>
              <View
                style={[$.inputField, inputFocused && $.inputFieldFocused]}
              >
                <TextInput
                  value={acctNum}
                  onChangeText={(t) =>
                    setAcctNum(t.replace(/[^0-9]/g, '').slice(0, 10))
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
                  <Text style={$.verifiedCheck}>✓</Text>
                  <Text style={$.verifiedName} numberOfLines={1}>
                    {resolvedName}
                  </Text>
                </View>
              )}
              {!resolving && error && (
                <Text style={$.errorLabel}>{error}</Text>
              )}
            </View>
          </View>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 24 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={goBack}
              />
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
          setAcctNum('');
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
              <Text style={m.closeX}>✕</Text>
            </Pressable>
          </View>

          {/* Search */}
          <View style={m.searchRow}>
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
                <Text style={m.clearX}>✕</Text>
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
                  >
                    <Text
                      style={[m.bankName, active && m.bankNameActive]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {active && <Text style={m.checkMark}>✓</Text>}
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
  dotDone: { backgroundColor: 'rgba(59,130,246,0.45)' },
  dotActive: { backgroundColor: C.accent },

  // Title
  heading: {
    fontSize: 28,
    fontWeight: '700',
    color: C.textPrimary,
    lineHeight: 36,
    marginBottom: 8,
  },
  subheading: {
    fontSize: 15,
    fontWeight: '400',
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
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  charCount: {
    fontSize: 12,
    fontWeight: '500',
    color: C.textPlaceholder,
  },

  selectField: {
    height: 54,
    backgroundColor: C.field,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.fieldBorder,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectFieldPressed: { backgroundColor: '#222226' },
  selectFieldFocused: { borderColor: C.focus },
  selectText: {
    flex: 1,
    minWidth: 0,         // RN flex quirk: lets the text shrink instead of growing to content
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '500',
    color: C.textPrimary,
    marginRight: 8,
  },
  selectTextPlaceholder: {
    color: C.textSecondary,
    fontWeight: '400',
  },
  selectChevron: {
    flexShrink: 0,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
    height: 54,
    backgroundColor: C.field,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.fieldBorder,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  inputFieldFocused: { borderColor: C.focus },
  inputText: {
    fontSize: 16,
    fontWeight: '500',
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
    fontSize: 13,
    fontWeight: '400',
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
    fontSize: 13,
    fontWeight: '600',
    color: C.green,
    maxWidth: 200,
  },
  errorLabel: {
    fontSize: 13,
    fontWeight: '400',
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
    fontSize: 20,
    fontWeight: '700',
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
    height: 46,
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
    fontSize: 15,
    fontWeight: '400',
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
    fontSize: 14,
    fontWeight: '400',
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
    fontSize: 15,
    fontWeight: '500',
    color: C.textPrimary,
  },
  bankNameActive: {
    color: C.accent,
    fontWeight: '600',
  },
  checkMark: {
    fontSize: 16,
    fontWeight: '700',
    color: C.accent,
  },
});
