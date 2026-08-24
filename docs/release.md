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
成果物のファイル名はこの値から決まるので、以降の手順に出てくる `0.2.0` は読み替える。

リリースするコミットは push しておく。
タグとバイナリの中身が食い違わないよう、作業を未コミットのまま残さない。

## 2. ビルドする

前回の成果物が混ざらないように `release/` を消してから実行する。

```sh
rm -rf release
APPLE_KEYCHAIN_PROFILE=jmd-notary npm run dist:mac
```

arm64 の dmg と zip が `release/` に出る（Apple Silicon 専用。Intel 版の x64 ビルドは廃止した）。
自動更新が読む `latest-mac.yml` と blockmap も同じ場所に出る。

公証は Apple のサーバとのやり取りを伴うため、成果物ごとに数分かかる。
アプリ1本と dmg 1本で計2回の送信になる。

環境変数を渡さないと公証は警告を出してスキップされる。
手元で動作を見るだけなら `npm run dist:mac:local` を使う。
こちらは認証情報を明示的に空にするので、確実に公証を飛ばす。

## 3. 署名と公証を検証する

公証が通っていないと、ユーザーの手元で Gatekeeper に弾かれる。
electron-builder が公証するのはアプリだけで、それを包んだ dmg は `scripts/notarize-dmg.cjs` が処理している。
両方を確かめる。

```sh
spctl -a -vvv -t install release/mac-arm64/jmd.app
spctl -a -vvv -t open --context context:primary-signature release/jmd-0.2.0-arm64.dmg
```

2つとも `accepted` と `source=Notarized Developer ID` が出れば配布できる。
`source=Unnotarized Developer ID` が出た場合は署名だけが済んで公証が飛んでいる。
環境変数 `APPLE_KEYCHAIN_PROFILE` を渡し忘れていないか確認する。

## 4. タグを打ってリリースを作る

`gh release create` はタグも同時に作るので、タグを別途 push する必要はない。
まずドラフトで作り、内容を確認してから公開する。

```sh
gh release create v0.2.0 --draft --target main \
  --title "jmd v0.2.0" \
  --notes-file docs/release-notes-v0.2.0.md \
  release/jmd-0.2.0-arm64.dmg \
  release/jmd-0.2.0-arm64.zip \
  release/jmd-0.2.0-arm64.zip.blockmap \
  release/latest-mac.yml
```

dmg 以外の3つはアプリ内の自動更新が読む。
手で入れ替えてもらうだけなら dmg で足りるが、いま動いている v0.2.0 以降のアプリはこの3つを見て更新する。

- **`latest-mac.yml`**：最新版の番号と zip のハッシュ。アプリが最初に取りにいく
- **`.zip`**：更新の実体。Squirrel.Mac は dmg を扱えないので、更新に使われるのはこちらである
- **`.zip.blockmap`**：変わったブロックだけを落とすための索引

`latest-mac.yml` と zip のどちらかが欠けると、更新は見つからないか、見つかっても落とせない。
blockmap だけが欠けた場合は更新できるが、差分転送が効かず毎回 100MB 超を落とすことになる。

`latest-mac.yml` に dmg の項目は入っていない。
electron-builder は成果物を作った時点でハッシュとサイズを控え、最後にまとめて書き出す。
その途中で `scripts/notarize-dmg.cjs` が dmg に署名して公証を貼り付け、中身を書き換えてしまう。
控えられた値は実物と合わなくなるので、`scripts/prune-dmg-update-info.cjs` が項目ごと落としている。

このスクリプトが electron-builder のフックではなく後処理なのは、書き出しの順序による。
`afterAllArtifactBuild` は `latest-mac.yml` が書かれる前に走るので、
そこで直しても直後に上書きされる。
`dist:mac` と `dist:mac:local` の両方に繋いであるため、普段は意識しなくてよい。

同じ理由で `.dmg.blockmap` も実物と合っていない。
こちらも上げない。

リリースノートには次を書く。

- Apple Silicon 専用であること（Intel 版の x64 ビルドは廃止した）
- 署名と公証を通しているので、警告なしにそのまま開けること
- 主な機能と、前回からの変更点

確認できたらブラウザか次のコマンドで公開する。

```sh
gh release edit v0.2.0 --draft=false
```

## 更新版を出すときにユーザーが行うこと

v0.2.0 以降のアプリは自分で更新する。
起動から数秒後に GitHub のリリースを見にいき、新しい版があれば知らせる。
メニューの Check for Updates… からも同じ確認ができる。

ダウンロードするかどうかは必ず利用者に尋ねる。
100MB を超える転送を黙って始めるわけにはいかないからである。
承諾されたあとはウィンドウのプログレスバーだけを出して背後で落とし、終わってから再起動を尋ねる。

再起動を選ぶと、まず全ウィンドウを閉じにいく。
Squirrel はアプリを終了させてバンドルごと差し替えるため、
未保存のタブを抱えたまま渡すと、そのまま消える。
ウィンドウを閉じる経路を通せば、いつもの保存確認が出る。
そこで取り消された場合、更新は次に普通に終了したときへ持ち越される（`autoInstallOnAppQuit`）。

v0.1.2 以前からは自動で上がれない。
更新の仕組みを積んでいないので、一度だけ手で dmg を入れ替えてもらう必要がある。

macOS では署名のないアプリに更新を上書きできない。
`npm run dist:mac:local` で作ったビルドは、更新を確認した時点で署名のエラーになる。
自動更新の動作を確かめるときは、公証まで通したビルドを使う。

設定は `~/Library/Application Support/jmd` に置かれており、アプリ本体の外にある。
アプリを差し替えても失われない。

このディレクトリ名は `package.json` の `productName` から決まる。
ここを変更すると、ユーザーから見れば設定が消えたのと同じことになるので、変更しない。

同じ理由で、画面の読み込み方法（`electron/main.js` の `loadFile`）も変更しない。
設定の実体は `file://` オリジンの localStorage にあり、カスタムプロトコルへ移すと読めなくなる。
移行するなら設定を引き継ぐ処理を併せて入れる。

## Windows 版を追加する

Windows 版は Windows 機で別にビルドし、同じリリースに後から足す。
macOS 版を先に公開してしまってかまわない。

```sh
npm run dist:win
gh release upload v0.2.0 \
  "release/jmd Setup 0.2.0.exe" \
  "release/jmd Setup 0.2.0.exe.blockmap" \
  release/latest.yml
```

ファイル名は electron-builder の nsis 既定によるものなので、実際の出力を `ls release` で確認してから指定する。

macOS 側が `latest-mac.yml` を読むのに対し、Windows 側は `latest.yml` を読む。
名前が違うので同じリリースに同居でき、片方だけ上げてももう片方の更新は壊れない。
nsis のインストーラは dmg と違って後から署名し直していないため、こちらは blockmap もハッシュも実物と合っている。

`dist:win` に付いている `-c.extraMetadata.description=jmd` は消さないこと。
electron-builder は exe のバージョン情報の `FileDescription` を `description || productName` の順で埋めるが、
Windows のシェルはこの `FileDescription` を「プログラムから開く」一覧の表示名に使う。
上書きしないと `package.json` の説明文がそのままアプリ名として出てしまう。

Windows には Apple のような公証はないが、署名のない実行ファイルは SmartScreen が警告を出す。
警告を消すにはコードサイニング証明書が別途要る。

## 未確認の項目

- Windows 版には署名を入れていない。
- 自動更新が実際に走るところは、まだ通しで見ていない。
  古い版から新しい版へ上がる経路は、v0.2.0 が公開され、その次の版が出てはじめて試せる。
  次のリリースでは、公開後に v0.2.0 のアプリから更新できることを必ず確かめる。
