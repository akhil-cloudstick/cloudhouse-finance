import React from "react";
import { FlatList, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { colors, statusColors, StatusTone } from "../../src/theme/colors";
import { getCalendarEvents } from "../../src/api/reminders";
import { CalendarEvent } from "../../src/types/reminder";

function toneForType(type: CalendarEvent["type"]): StatusTone {
  if (type === "Overdue") return "red";
  if (type === "LoanDue" || type === "InterestDue") return "amber";
  if (type === "PromiseToPay") return "blue";
  return "muted";
}

// Current month's events, computed server-side (manual reminders + live
// loan due/overdue/interest events) — no client-side date math or filtering.
export default function RemindersScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["reminders", "calendar"],
    queryFn: () => getCalendarEvents(),
  });

  return (
    <ScreenContainer style={{ paddingHorizontal: 0 }}>
      <FlatList<CalendarEvent>
        data={data ?? []}
        keyExtractor={(item, idx) => `${item.date}-${item.type}-${item.loanId ?? item.reminderId ?? idx}`}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <ThemedText color={colors.muted}>
            {isLoading ? "Loading…" : isError ? "Could not load reminders." : "Nothing due this month."}
          </ThemedText>
        }
        renderItem={({ item }) => {
          const tone = statusColors(toneForType(item.type));
          return (
            <Card>
              <ThemedText
                variant="label"
                style={{
                  alignSelf: "flex-start",
                  backgroundColor: tone.bg,
                  color: tone.fg,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                  marginBottom: 6,
                }}
              >
                {item.type}
              </ThemedText>
              <ThemedText variant="h3">{item.title}</ThemedText>
              <ThemedText variant="small" color={colors.muted}>
                {item.date} · {item.detail}
              </ThemedText>
            </Card>
          );
        }}
      />
    </ScreenContainer>
  );
}
