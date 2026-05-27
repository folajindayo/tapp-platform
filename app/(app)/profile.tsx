// Profile-edit screen — edits first/last name via PATCH /v1/me.
// Email + scope live on a different flow (re-verification / role grant)
// and aren't user-editable here.

import { useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react-native';
import { authApi } from '@/api/endpoints';
import { queryKeys } from '@/queries/keys';
import { Button, Text } from '@/ui';

const PAL = {
  bg:         '#0D0D0D',
  cardBg:     '#121214',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  fieldBg:    'rgba(255, 255, 255, 0.06)',
  text:       '#FFFFFF',
  textMuted:  'rgba(255, 255, 255, 0.55)',
  textSubtle: 'rgba(255, 255, 255, 0.35)',
} as const;

export default function ProfileScreen() {
  const qc = useQueryClient();
  const meQuery = useQuery({ queryKey: queryKeys.auth.me(), queryFn: authApi.me });

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  // Seed inputs from the loaded /me once. Subsequent loads (cache
  // refreshes after a save) keep whatever the user is currently typing.
  useEffect(() => {
    if (meQuery.data) {
      setFirstName(meQuery.data.first_name ?? '');
      setLastName(meQuery.data.last_name ?? '');
    }
  }, [meQuery.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: () =>
      authApi.updateMe({
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
      }),
    onSuccess: async (fresh) => {
      qc.setQueryData(queryKeys.auth.me(), fresh);
      Keyboard.dismiss();
      router.replace('/(app)/settings');
    },
    onError: (err) => {
      Alert.alert('Couldn’t save', (err as { message?: string })?.message ?? 'Try again');
    },
  });

  const original = meQuery.data;
  const dirty =
    (original?.first_name ?? '') !== firstName.trim() ||
    (original?.last_name ?? '') !== lastName.trim();
  const valid = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <SafeAreaView edges={['top']} style={s.root}>
      <View style={s.header}>
        <Pressable hitSlop={12} onPress={() => router.replace('/(app)/settings')} style={s.backBtn}>
          <ChevronLeft size={22} color={PAL.text} />
        </Pressable>
        <Text style={s.title}>Profile</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.card}>
          <Field
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
            textContentType="givenName"
          />
          <Field
            label="Last name"
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
            textContentType="familyName"
          />
          <Field
            label="Email"
            value={original?.email ?? ''}
            editable={false}
            hint="Email changes aren't supported yet."
          />
        </View>

        <View style={{ height: 16 }} />

        <View style={{ width: '100%' }}>
          <Button
            label={mutation.isPending ? 'Saving…' : 'Save changes'}
            onPress={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!valid || !dirty || mutation.isPending}
            className="rounded-[16px]"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText?: (s: string) => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  textContentType?: 'givenName' | 'familyName' | 'emailAddress' | 'none';
  editable?: boolean;
  hint?: string;
}

function Field({ label, value, onChangeText, autoCapitalize, textContentType, editable = true, hint }: FieldProps) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        textContentType={textContentType ?? 'none'}
        style={[s.input, !editable && s.inputDisabled]}
        placeholderTextColor={PAL.textSubtle}
      />
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAL.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 17,
    color: PAL.text,
  },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: PAL.cardBorder,
    backgroundColor: PAL.cardBg,
    padding: 16,
    gap: 16,
  },
  field: { gap: 8 },
  fieldLabel: {
    fontFamily: 'BricolageGrotesque-SemiBold',
    fontSize: 14,
    color: PAL.text,
  },
  input: {
    height: 52,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: PAL.fieldBg,
    color: PAL.text,
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 15,
  },
  inputDisabled: { opacity: 0.5 },
  fieldHint: {
    fontFamily: 'BricolageGrotesque-Regular',
    fontSize: 12,
    color: PAL.textMuted,
  },
});
