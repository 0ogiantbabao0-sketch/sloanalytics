import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { Provider } from "@/components/provider";
import { Shell } from "@/components/shell";
export const metadata: Metadata = {
  title: "SLOT ANALYTICS | データで、次の選択を。",
  description: "ホールと機種の実績を、根拠とともに比較する分析ワークスペース。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <Provider>
          <Shell>{children}</Shell>
        </Provider>
      </body>
    </html>
  );
}
