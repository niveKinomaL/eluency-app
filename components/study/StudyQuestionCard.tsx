import { Image, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { GameWord, StudySessionMode } from "../../types/study-game";
import { useAppTheme } from "../../lib/theme";

export function StudyQuestionCard({
  word,
  prompt,
  mode,
  value,
  onChangeValue,
  mcqOptions,
  selectedOptionId,
  onSelectOption,
}: {
  word: GameWord;
  prompt: string;
  mode: StudySessionMode;
  value: string;
  onChangeValue: (v: string) => void;
  mcqOptions?: { id: string; text: string }[];
  selectedOptionId?: string | null;
  onSelectOption?: (id: string) => void;
}) {
  const theme = useAppTheme();
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceAlt,
        padding: 14,
      }}
    >
      <Text style={[theme.typography.caption, { textTransform: "uppercase", marginBottom: 6 }]}>{mode}</Text>
      <Text style={[theme.typography.bodyStrong, { fontSize: 20, marginBottom: 12 }]}>{prompt || "—"}</Text>

      {word.imageUrl ? (
        <Image
          source={{ uri: word.imageUrl }}
          style={{ width: "100%", height: 180, borderRadius: 10, marginBottom: 12, backgroundColor: theme.colors.surface }}
          resizeMode="cover"
        />
      ) : null}

      {mode === "multiple-choice" && Array.isArray(mcqOptions) && mcqOptions.length >= 2 ? (
        <View style={{ gap: 8 }}>
          {mcqOptions.map((o) => {
            const selected = selectedOptionId === o.id;
            return (
              <TouchableOpacity
                key={o.id}
                onPress={() => onSelectOption?.(o.id)}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
                }}
              >
                <Text style={{ fontWeight: "700", color: theme.colors.text }}>{o.text}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChangeValue}
          placeholder="Type your answer..."
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
          }}
        />
      )}
    </View>
  );
}

