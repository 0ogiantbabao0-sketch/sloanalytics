import { Suspense } from "react";
import { Units } from "@/components/units";
export default function Page() {
  return (
    <Suspense fallback={<p>読み込み中…</p>}>
      <Units />
    </Suspense>
  );
}
