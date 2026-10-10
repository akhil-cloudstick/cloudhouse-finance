import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { C } from "./base";

type SparklineProps = { data: number[]; height?: number };

/** Dashboard "Cash flow · 7 days" area sparkline (prototype drawChart). */
export function Sparkline({ data, height = 60 }: SparklineProps) {
  const [w, setW] = useState(0);
  const path = useMemo(() => {
    if (!w || data.length < 2) return null;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const p = 4;
    const step = (w - p * 2) / (data.length - 1);
    const pts = data.map((v, i) => [p + i * step, height - p - ((v - min) / range) * (height - p * 2)] as const);
    const line = pts.map((pt, i) => `${i ? "L" : "M"}${pt[0]},${pt[1]}`).join(" ");
    return { line, area: `${line} L${w - p},${height} L${p},${height} Z`, last: pts[pts.length - 1] };
  }, [w, data, height]);
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {path ? (
        <Svg width={w} height={height}>
          <Path d={path.area} fill="#6e142322" />
          <Path d={path.line} stroke={C.brandDeep} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" fill="none" />
          <Circle cx={path.last[0]} cy={path.last[1]} r={3.5} fill={C.brandDeep} />
        </Svg>
      ) : null}
    </View>
  );
}
