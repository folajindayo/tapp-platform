import React from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { AlertCircle } from "lucide-react-native";
import { Button, Text } from "@/ui";
import { theme } from "@/ui/theme";

interface EarlyAccessModalProps {
  visible: boolean;
  onClose: () => void;
}

export function EarlyAccessModal({ visible, onClose }: EarlyAccessModalProps) {
  const contactAdmin = async () => {
    const url = "https://t.me/oxbryte";
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          "Could not open Telegram",
          "Please message @oxbryte directly on Telegram."
        );
      }
    } catch {
      Alert.alert(
        "Error",
        "Could not open Telegram. Please contact @oxbryte."
      );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <Pressable style={s.backdropTouch} onPress={onClose} />
        
        <View style={s.card}>
          <View style={s.iconBadge}>
            <AlertCircle size={32} color={theme.colors.warning} />
          </View>

          <Text style={s.title}>Early Access Awaiting Approval</Text>
          
          <Text style={s.description}>
            Your early access request is still pending. Please reach out to an admin on Telegram to get your account approved.
          </Text>

          <View style={s.actions}>
            <Button
              label="Contact Admin (@oxbryte)"
              onPress={contactAdmin}
              className="rounded-xl h-12 w-full mb-3"
            />
            
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                s.closeButton,
                pressed && s.closeButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={s.closeText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.82)",
    justifyContent: "center",
    alignItems: "center",
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: "85%",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    ...theme.shadows.raised,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.warningBg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontFamily: theme.fontFamilies.display,
    fontSize: 20,
    lineHeight: 26,
    color: theme.colors.textStrong,
    textAlign: "center",
    marginBottom: 12,
  },
  description: {
    fontFamily: theme.fontFamilies.text,
    fontSize: 15,
    lineHeight: 21,
    color: theme.colors.textMuted,
    textAlign: "center",
    marginBottom: 28,
  },
  actions: {
    width: "100%",
    alignItems: "center",
  },
  closeButton: {
    height: 48,
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  closeButtonPressed: {
    backgroundColor: theme.colors.surfaceSubtle,
  },
  closeText: {
    fontFamily: theme.fontFamilies.textMedium,
    fontSize: 15,
    color: theme.colors.textMuted,
  },
});
