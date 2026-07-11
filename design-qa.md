# Clockhand ブランド Design QA

## 比較対象

- source visual truth: `/Users/aki-0421/.codex/generated_images/019f4ed5-4f85-7d22-b5b0-bba8c79e2499/exec-bbc7626c-1b6a-4f20-a69d-61436ec345f7.png`
- implementation asset: `apps/desktop/src-tauri/icons/icon-master.png`
- implementation screenshot: `/tmp/clockhand-implemented-icon-final.png`
- bundled icon screenshot: `/tmp/clockhand-bundled-icon.png`
- browser-rendered implementation screenshot: `/tmp/clockhand-settings.png`
- full-view comparison evidence: `/tmp/clockhand-icon-comparison-final.png`
- focused small-size evidence: `/tmp/clockhand-small-sizes-v2.png`
- icon viewport: 1024 x 1024、front-facing App Icon、transparent outside squircle。
- browser viewport: 1280 x 720、dark theme、`/settings/`。
- state: final Clockhand icon、32 px / 16 px light and dark surface、Settings initial loaded state。

## Findings

actionable な P0 / P1 / P2 finding は残っていない。

- Fonts and typography: App Icon 内に text を入れていないため font fidelity の対象外。browser document title は `Clockhand` で、wordmark capitalization と一致する。
- Spacing and layout rhythm: squircle は master canvas の約 92% を使い、dial、chevron、blue marker の比率と gap は source と同じ visual hierarchy を保つ。source board の presentation shadow は bundle asset に持ち込んでいない。
- Colors and visual tokens: graphite、off-white、signal blue の三色構成を維持した。light / dark surface の両方で outer silhouette と active marker を判別できる。
- Image quality and asset fidelity: 1024 px master から 512 px、256 px、128 px、32 px を生成した。alpha corner、edge matte、blue marker に chroma-key fringe は見られない。32 px と 16 px 相当でも clock dial と right-facing chevron を判別できる。
- Copy and content: Tauri / Next metadata、Settings description、notification、diagnostics / run-log export は `Clockhand` を使う。App Icon 自体には copy を含めない。

## Comparison History

1. 初回比較 `/tmp/clockhand-icon-comparison.png` では、implementation の dial と chevron が source より小さく、16 px で stroke が弱くなる P2 mismatch があった。
2. glyph の optical weight と squircle の canvas occupancy を上げた icon-only asset を再生成し、transparent master を約 92% occupancy に正規化した。
3. post-fix comparison `/tmp/clockhand-icon-comparison-final.png` では symbol hierarchy、line weight、gap、marker placement が source と同等になった。残る graphite texture の差は、presentation render と transparent bundle asset の用途差による P3 variation として許容する。

## Browser Verification

- `agent-browser` で `http://127.0.0.1:4317/settings/` を開いた。
- document title が `Clockhand` であることを確認した。
- Settings initial state、sidebar、header、switch、save action が表示されることを確認した。
- browser console error は 0 件。development-only React DevTools info だけが出力された。
- brand change に interaction flow の変更はないため、primary interaction は page load と Settings surface の表示確認に限定した。
- debug app bundle `target/debug/bundle/macos/Clockhand.app` を生成し、`CFBundleDisplayName`、`CFBundleName`、`CFBundleIconFile` が Clockhand を参照することと、bundle 内の `Clockhand.icns` が final asset を保持することを確認した。

## Follow-up Polish

- P3: macOS 実機 Dock 上で周囲の主要アプリアイコンと並べ、graphite texture の見え方を最終調整できる。
- P3: menu bar surface を追加する場合は、dial + chevron の monochrome template image を別 asset として作る。

final result: passed
