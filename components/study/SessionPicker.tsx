import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import type { StudySessionMode, StudySessionType } from "../../types/study-game";
import { useAppTheme } from "../../lib/theme";

export function SessionTypePicker({
  value,
  onChange,
}: {
  value: StudySessionType;
  onChange: (next: StudySessionType) => void;
}) {
  const theme = useAppTheme();
  const opts: StudySessionType[] = [
    "practice",
    "test",
    "daily-challenge",
    "review-mistakes",
    "smart-review",
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
      {opts.map((o) => (
        <TouchableOpacity
          key={o}
          onPress={() => onChange(o)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            marginRight: 8,
            borderWidth: 1,
            borderColor: value === o ? theme.colors.primary : theme.colors.border,
            backgroundColor: value === o ? theme.colors.primarySoft : theme.colors.surfaceAlt,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>
            {o.replace("-", " ")}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export function SessionModePicker({
  value,
  onChange,
}: {
  value: StudySessionMode;
  onChange: (next: StudySessionMode) => void;
}) {
  const theme = useAppTheme();
  const opts: StudySessionMode[] = ["typing", "multiple-choice", "listening", "image"];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {opts.map((o) => (
        <TouchableOpacity
          key={o}
          onPress={() => onChange(o)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: value === o ? theme.colors.primary : theme.colors.border,
            backgroundColor: value === o ? theme.colors.primarySoft : theme.colors.surfaceAlt,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "700" }}>{o}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

