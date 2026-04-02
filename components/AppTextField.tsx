import { ReactNode } from "react";
import { Text, TextInput, TextInputProps, View } from "react-native";
import { useAppTheme } from "../lib/theme";

type AppTextFieldProps = TextInputProps & {
  label: string;
  icon?: ReactNode;
  error?: string;
  helperText?: string;
};

export default function AppTextField({
  label,
  icon,
  error,
  helperText,
  onFocus,
  onBlur,
  ...props
}: AppTextFieldProps) {
  const theme = useAppTheme();

  // Keep focus styling static on Android to avoid keyboard/focus flicker loops.
  const borderColor = error ? theme.colors.danger : theme.colors.border;

  return (
    <View style={{ gap: 8 }}>
      <Text style={theme.typography.label}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          borderRadius: 22,
          borderWidth: 1,
          borderColor,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: 16,
          paddingVertical: 2,
          shadowColor: theme.colors.shadow,
          shadowOpacity: theme.isDark ? 0.18 : 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 0,
        }}
      >
        {icon ? <View>{icon}</View> : null}
        <TextInput
          placeholderTextColor={theme.colors.textSoft}
          style={[
            theme.typography.body,
            {
              flex: 1,
              minHeight: 54,
              color: theme.colors.text,
            },
          ]}
          onFocus={(event) => onFocus?.(event)}
          onBlur={(event) => onBlur?.(event)}
          {...props}
        />
      </View>
      {error ? (
        <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>
          {error}
        </Text>
      ) : helperText ? (
        <Text style={theme.typography.caption}>{helperText}</Text>
      ) : null}
    </View>
  );
}

