import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';
import { CheckCircle, Info, XCircle } from 'lucide-react-native';

export type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastState {
  toast: ToastMessage | null;
  show: (message: string, type?: ToastType) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (message, type = 'info') => {
    const id = Math.random().toString(36).substring(7);
    set({ toast: { id, message, type } });
  },
  hide: () => set({ toast: null }),
}));

export const toast = {
  success: (msg: string) => useToastStore.getState().show(msg, 'success'),
  error: (msg: string) => useToastStore.getState().show(msg, 'error'),
  info: (msg: string) => useToastStore.getState().show(msg, 'info'),
};

export function ToastContainer() {
  const activeToast = useToastStore((s) => s.toast);
  const hide = useToastStore((s) => s.hide);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-45)).current;

  useEffect(() => {
    if (activeToast) {
      // Reset animations
      opacity.setValue(0);
      translateY.setValue(-45);

      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: -20,
            duration: 250,
            useNativeDriver: true,
          }),
        ]).start(() => {
          hide();
        });
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [activeToast, hide, opacity, translateY]);

  if (!activeToast) return null;

  const config = {
    success: {
      bg: '#1C3D1E',
      border: '#30D158',
      icon: <CheckCircle size={20} color="#30D158" />,
    },
    error: {
      bg: '#4A1517',
      border: '#FF453A',
      icon: <XCircle size={20} color="#FF453A" />,
    },
    info: {
      bg: '#1C1C1E',
      border: '#2C2C2E',
      icon: <Info size={20} color="#298DFF" />,
    },
  }[activeToast.type];

  return (
    <Animated.View
      style={[
        styles.root,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Pressable
        onPress={() => {
          Animated.parallel([
            Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
            Animated.timing(translateY, { toValue: -20, duration: 200, useNativeDriver: true }),
          ]).start(hide);
        }}
        style={[
          styles.container,
          {
            backgroundColor: config.bg,
            borderColor: config.border,
          },
        ]}
      >
        <View style={styles.iconWrap}>{config.icon}</View>
        <Text style={styles.text} numberOfLines={2}>
          {activeToast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    zIndex: 999999,
    alignItems: 'center',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 8,
    maxWidth: '100%',
    minWidth: 280,
  },
  iconWrap: {
    marginRight: 12,
  },
  text: {
    fontFamily: 'BricolageGrotesque-Medium',
    fontSize: 14,
    color: '#FAFAFA',
    flex: 1,
  },
});
