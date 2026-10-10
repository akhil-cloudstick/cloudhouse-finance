import { View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { s } from "./cardStyles";

type StepperProps = { steps: string[]; current: number; allDone?: boolean };

/** .stepper — custody / auction progress. `current` is 0-based. */
export function Stepper({ steps, current, allDone }: StepperProps) {
  return (
    <View style={s.stepper}>
      {steps.map((label, i) => {
        const done = allDone || i < current;
        const cur = !allDone && i === current;
        return (
          // Each step's connector reaches back into the previous step's cell;
          // stacking earlier steps above later ones keeps it UNDER that dot.
          <View key={label} style={[s.step, { zIndex: steps.length - i }]}>
            {i > 0 ? <View style={[s.stepLine, done && { backgroundColor: C.brandDeep }]} /> : null}
            <View style={[s.stepDot, done && { backgroundColor: C.brandDeep }, cur && { backgroundColor: C.accent }]}>
              {done ? <PIcon name="check" color="#fff" size={12} strokeWidth={3} /> : <Txt style={[s.stepDotTxt, cur && { color: "#fff" }]}>{i + 1}</Txt>}
            </View>
            <Txt style={[s.stepLabel, (done || cur) && { color: C.ink }]}>{label}</Txt>
          </View>
        );
      })}
    </View>
  );
}
