import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  X,
} from 'lucide-react-native';
import { catalogApi, merchantApi, verifyApi } from '@/api/endpoints';
import { Button, Screen, Text } from '@/ui';
import { StepHeader } from '@/components/StepHeader';

const CURRENCY = 'NGN';

// Tapp /send-style palette — kept local to keep this screen self-contained
// while we promote these into a shared form primitives module.
const PAL = {
  bg:           '#0D0D0D',
  cardBg:       '#121214',  // subtle lift off the screen
  cardBorder:   'rgba(255, 255, 255, 0.08)',
  fieldBg:      '#1F1F22',  // distinctly brighter than card → fields read as inset
  fieldBorder:  'rgba(255, 255, 255, 0.10)',
  fieldFocus:   '#3B82F6',
  text:         '#FFFFFF',
  textValue:    'rgba(255, 255, 255, 0.92)',
  textMuted:    'rgba(255, 255, 255, 0.55)',
  textSubtle:   'rgba(255, 255, 255, 0.45)',
  required:     '#F43F5E',
  success:      '#22C55E',
  successBg:    'rgba(34, 197, 94, 0.14)',
  iconTint:     'rgba(255, 255, 255, 0.55)',
  badgeBg:      'rgba(59, 130, 246, 0.14)',
  badgeIcon:    '#3B82F6',
  sheet:        '#1C1C1E',
  sheetHandle:  '#3A3A3C',
  rowPressed:   'rgba(255, 255, 255, 0.06)',
  hairline:     'rgba(255, 255, 255, 0.08)',
} as const;

export default function BankAccountScreen() {
  const queryClient = useQueryClient();
  const institutionsQuery = useQuery({
    queryKey: ['catalog', 'institutions', CURRENCY],
    queryFn: () => catalogApi.institutions(CURRENCY),
  });

  const [bankCode, setBankCode] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [accountFocused, setAccountFocused] = useState(false);

  const bank = useMemo(
    () => institutionsQuery.data?.find((i) => i.code === bankCode),
    [institutionsQuery.data, bankCode],
  );

  useEffect(() => {
    setResolvedName(null);
    setError(null);
    if (!bankCode || accountNumber.length !== 10) return;
    const handle = setTimeout(async () => {
      setResolving(true);
      try {
        const res = await verifyApi.account({
          institution: bankCode,
          account_identifier: accountNumber,
          currency: CURRENCY,
        });
        setResolvedName(res);
      } catch (err) {
        setError((err as { message?: string })?.message ?? 'Could not verify account');
      } finally {
        setResolving(false);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [bankCode, accountNumber]);

  async function save() {
    if (!bankCode || !resolvedName || accountNumber.length !== 10) return;
    setSaving(true);
    try {
      await merchantApi.saveBankAccount({
        currency: CURRENCY,
        bank_code: bankCode,
        account_number: accountNumber,
        account_name: resolvedName,
      });
      await queryClient.invalidateQueries({ queryKey: ['merchant', 'bank-account'] });
    } catch (err) {
      Alert.alert('Could not save', (err as { message?: string })?.message ?? 'Try again');
    } finally {
      setSaving(false);
    }
  }

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(onboarding)/kyb');
  };

  const canSave = !!resolvedName && !resolving;

  return (
    <Screen>
      <StepHeader
        step={4}
        totalSteps={4}
        title="Where should we send your money?"
        subtitle="Bank payouts settle in NGN to this account."
        onBack={handleBack}
      />

      <View style={s.body}>
        {/* Form card — tapp /send pattern: rounded-3xl bordered group with gap-4 fields */}
        <View style={s.card}>
          {/* Bank picker field */}
          <View style={s.field}>
            <View style={s.labelRow}>
              <Text style={s.label}>
                Bank <Text style={s.required}>*</Text>
              </Text>
            </View>
            <Pressable
              onPress={() => setPicker(true)}
              style={({ pressed }) => [
                s.control,
                pressed && s.controlPressed,
              ]}
            >
              <View style={s.bankValueWrap}>
                {bank ? (
                  <View style={s.bankBadge}>
                    <Building2 size={14} color={PAL.badgeIcon} />
                  </View>
                ) : null}
                <Text
                  style={bank ? s.controlValue : s.controlPlaceholder}
                  numberOfLines={1}
                >
                  {bank ? bank.name : 'Choose your bank'}
                </Text>
              </View>
              <ChevronDown size={18} color={PAL.iconTint} />
            </Pressable>
          </View>

          {/* Account number field */}
          <View style={s.field}>
            <View style={s.labelRow}>
              <Text style={s.label}>
                Account number <Text style={s.required}>*</Text>
              </Text>
              <Text style={s.labelMeta}>{accountNumber.length}/10</Text>
            </View>
            <View
              style={[
                s.control,
                accountFocused && { borderColor: PAL.fieldFocus },
              ]}
            >
              <TextInput
                value={accountNumber}
                onChangeText={(t) => setAccountNumber(t.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="10-digit NUBAN"
                placeholderTextColor={PAL.textSubtle}
                keyboardType="number-pad"
                maxLength={10}
                onFocus={() => setAccountFocused(true)}
                onBlur={() => setAccountFocused(false)}
                style={s.input}
                autoCorrect={false}
                spellCheck={false}
              />
            </View>

            {/* Helper row — verifying / resolved / error */}
            {resolving ? (
              <View style={s.helperRow}>
                <ActivityIndicator size="small" color={PAL.textMuted} />
                <Text style={s.helperText}>Verifying account…</Text>
              </View>
            ) : resolvedName ? (
              <View style={s.resolvedRow}>
                <CheckCircle2 size={14} color={PAL.success} />
                <Text style={s.resolvedText} numberOfLines={1}>
                  {resolvedName}
                </Text>
              </View>
            ) : error ? (
              <Text style={s.errorText}>{error}</Text>
            ) : (
              <Text style={s.helperText}>We&apos;ll check the name against your bank.</Text>
            )}
          </View>
        </View>

        {/* Action row */}
        <View style={s.actions}>
          <View style={{ flex: 1 }}>
            <Button label="Cancel" variant="secondary" onPress={handleBack} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Save"
              onPress={save}
              loading={saving}
              disabled={!canSave}
            />
          </View>
        </View>
      </View>

      <BankPicker
        visible={picker}
        institutions={institutionsQuery.data ?? []}
        loading={institutionsQuery.isLoading}
        onSelect={(code) => {
          setBankCode(code);
          setPicker(false);
          setResolvedName(null);
        }}
        onClose={() => setPicker(false)}
      />
    </Screen>
  );
}

interface BankPickerProps {
  visible: boolean;
  institutions: { code: string; name: string }[];
  loading: boolean;
  onSelect: (code: string) => void;
  onClose: () => void;
}

function BankPicker({ visible, institutions, loading, onSelect, onClose }: BankPickerProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={ps.backdrop} onPress={onClose} />
      <View style={ps.sheet}>
        <View style={ps.handle} />
        <View style={ps.header}>
          <Text style={ps.title}>Choose your bank</Text>
          <Pressable hitSlop={12} onPress={onClose} style={ps.closeButton}>
            <X size={18} color={PAL.textMuted} />
          </Pressable>
        </View>

        {loading ? (
          <View style={ps.loadingWrap}>
            <ActivityIndicator color={PAL.fieldFocus} />
          </View>
        ) : (
          <FlatList
            data={institutions}
            keyExtractor={(i) => i.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={ps.list}
            ItemSeparatorComponent={() => <View style={ps.divider} />}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onSelect(item.code)}
                style={({ pressed }) => [ps.row, pressed && ps.rowPressed]}
              >
                <Text style={ps.rowText} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  body: {
    marginTop: 24,
    gap: 20,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: PAL.cardBorder,
    backgroundColor: PAL.cardBg,
    padding: 16,
    gap: 18,
  },
  field: {
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 14,
    color: PAL.text,
  },
  labelMeta: {
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 12,
    color: PAL.textMuted,
    fontVariant: ['tabular-nums'],
  },
  required: {
    color: PAL.required,
  },
  control: {
    height: 52,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PAL.fieldBorder,
    backgroundColor: PAL.fieldBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlPressed: {
    backgroundColor: '#27272B',
  },
  bankValueWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bankBadge: {
    height: 28,
    width: 28,
    borderRadius: 8,
    backgroundColor: PAL.badgeBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlValue: {
    flex: 1,
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 15,
    color: PAL.textValue,
  },
  controlPlaceholder: {
    flex: 1,
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 15,
    color: PAL.textSubtle,
  },
  input: {
    flex: 1,
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 15,
    color: PAL.textValue,
    padding: 0, // RN adds default vertical padding on Android
    fontVariant: ['tabular-nums'],
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  helperText: {
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 12,
    color: PAL.textMuted,
  },
  resolvedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: PAL.successBg,
  },
  resolvedText: {
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 12,
    color: PAL.success,
    maxWidth: 220,
  },
  errorText: {
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 12,
    color: PAL.required,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
});

const ps = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '82%',
    backgroundColor: PAL.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: PAL.sheetHandle,
    marginTop: 6,
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    fontFamily: 'BricolageGrotesque-Bold',
    fontSize: 18,
    color: PAL.text,
  },
  closeButton: {
    height: 32,
    width: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  loadingWrap: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  list: {
    paddingTop: 4,
  },
  row: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: 'center',
  },
  rowPressed: {
    backgroundColor: PAL.rowPressed,
  },
  rowText: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 16,
    lineHeight: 20,
    color: PAL.textValue,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: PAL.hairline,
    marginLeft: 20,
  },
});
