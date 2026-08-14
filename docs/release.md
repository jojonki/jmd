# リリース手順

macOS 版を GitHub Releases で配布するための手順。
Windows 版の追加は最後の節にまとめてある。

## 一度だけ済ませておく設定

配布には Apple の **Developer ID Application** 証明書が要る。
キーチェーンに入っていれば electron-builder が自動で見つけるため、設定ファイルに書くことはない。

公証には **App用パスワード** が要る。
[appleid.apple.com](https://appleid.apple.com) で発行し、キーチェーンに登録しておく。

```sh
xcrun notarytool store-credentials jmd-notary \
  --apple-id <Apple ID> --team-id W2Z92AW32J
```

登録済みかどうかは、送信履歴が引ければ確認できる。

```sh
xcrun notarytool history --keychain-profile jmd-notary
```

## 1. バージョンを上げる

`package.json` の `version` を更新する。
成果物のファイル名はこの値から決まるので、以降の手順に出てくる `0.1.0` は読み替える。

リリースするコミットは push しておく。
タグとバイナリの中身が食い違わないよう、作業を未コミットのまま残さない。

## 2. ビルドする

前回の成果物が混ざらないように `release/` を消してから実行する。

```sh
rm -rf release
APPLE_KEYCHAIN_PROFILE=jmd-notary npm run dist:mac
```

arm64 と x64 それぞれの dmg と zip が `release/` に出る。

公証は Apple のサーバとのやり取りを伴うため、成果物ごとに数分かかる。
アプリ2本と dmg 2本で計4回の送信になるので、全体で20分から30分を見ておく。

環境変数を渡さないと公証は警告を出してスキップされる。
手元で動作を見るだけなら `npm run dist:mac:local` を使う。
こちらは認証情報を明示的に空にするので、確実に公証を飛ばす。

## 3. 署名と公証を検証する

公証が通っていないと、ユーザーの手元で Gatekeeper に弾かれる。
electron-builder が公証するのはアプリだけで、それを包んだ dmg は `scripts/notarize-dmg.cjs` が処理している。
両方を確かめる。

```sh
spctl -a -vvv -t install release/mac-arm64/jmd.app
spctl -a -vvv -t install release/mac/jmd.app
spctl -a -vvv -t open --context context:primary-signature release/jmd-0.1.0-arm64.dmg
spctl -a -vvv -t open --context context:primary-signature release/jmd-0.1.0-x64.dmg
```

x64 のアプリが `release/mac` に出るのは electron-builder の既定である（arm64 は `release/mac-arm64`）。

4つとも `accepted` と `source=Notarized Developer ID` が出れば配布できる。
`source=Unnotarized Developer ID` が出た場合は署名だけが済んで公証が飛んでいる。
環境変数 `APPLE_KEYCHAIN_PROFILE` を渡し忘れていないか確認する。

## 4. タグを打ってリリースを作る

`gh release create` はタグも同時に作るので、タグを別途 push する必要はない。
まずドラフトで作り、内容を確認してから公開する。

```sh
gh release create v0.1.0 --draft --target main \
  --title "jmd v0.1.0" \
  --notes-file docs/release-notes-v0.1.0.md \
  release/jmd-0.1.0-arm64.dmg \
  release/jmd-0.1.0-x64.dmg \
  release/jmd-0.1.0-arm64.zip \
  release/jmd-0.1.0-x64.zip
```

zip を併せて上げているのは、将来 electron-updater による自動更新を入れるときに必要になるためである。
今は使っていないので、外しても配布には影響しない。

リリースノートには次を書く。

- Apple Silicon 版と Intel 版の選び方（`arm64` が Apple Silicon、`x64` が Intel）
- 署名と公証を通しているので、警告なしにそのまま開けること
- 主な機能と、前回からの変更点

確認できたらブラウザか次のコマンドで公開する。

```sh
gh release edit v0.1.0 --draft=false
```

## 更新版を出すときにユーザーが行うこと

新しい dmg をダウンロードし、`/Applications` のアプリを置き換えるだけでよい。

設定は `~/Library/Application Support/jmd` に置かれており、アプリ本体の外にある。
アプリを差し替えても失われない。

このディレクトリ名は `package.json` の `productName` から決まる。
ここを変更すると、ユーザーから見れば設定が消えたのと同じことになるので、変更しない。

同じ理由で、画面の読み込み方法（`electron/main.js` の `loadFile`）も変更しない。
設定の実体は `file://` オリジンの localStorage にあり、カスタムプロトコルへ移すと読めなくなる。
移行するなら設定を引き継ぐ処理を併せて入れる。

## Windows 版を追加する

Windows 版はまだビルドしていない。
用意できたら、同じリリースに後から足せる。

```sh
npm run dist:win
gh release upload v0.1.0 "release/jmd Setup 0.1.0.exe"
```

ファイル名は electron-builder の nsis 既定によるものなので、実際の出力を `ls release` で確認してから指定する。

Windows には Apple のような公証はないが、署名のない実行ファイルは SmartScreen が警告を出す。
警告を消すにはコードサイニング証明書が別途要る。

## 未確認の項目

- x64 のビルドは最後まで通していない。初回は成果物のファイル名と `spctl` の結果を必ず確認する。
- `artifactName` を明示して `jmd-0.1.0-x64.dmg` の形に固定してあるが、この命名での出力も未確認である。
- Windows 版のビルドは未着手である。
