# 新しい作業記録モデル

`activity_intervals` がタイムラインと集計の唯一の入力です。範囲は開始を含み終了を含まない `[start_at, end_at)` とし、同一ギルド・同一ユーザーの有効レコードは重複できません。

## コマンドへの対応

| 操作 | 書き込み |
| --- | --- |
| `/start` | pause中なら記憶した科目・作業名で新しい未終了 interval を作成。別作業指定なら既存未終了 interval を現在時刻で閉じてから作成する。 |
| `/pause` | 未終了 interval を現在時刻で閉じ、`activity_state` に再開用の科目・作業名・時刻を保存する。pause時間そのものは interval にしない。 |
| `/stop` | 未終了 interval を現在時刻で閉じ、`activity_state` を空状態にする。 |
| `/edit` | `replaceRange` を1トランザクションで呼ぶ。実行中intervalと重なる編集は拒否し、先に `/stop` を要求する。 |

`/start`、`/pause`、`/stop` もユーザー単位の advisory lock を取得して書き込みます。DBの排他制約は、実装漏れやWebコンソールとの競合に対する最後の防波堤です。

## 編集の手順

1. 対象ユーザーをロックし、入力が `start < end` であることを検証する。
2. 実行中の interval と交差する場合は失敗させる。
3. 対象範囲と交差する有効・確定済み interval を `FOR UPDATE` で取得する。
4. それらを `is_active=false` にし、今回の mutation を記録する。
5. 旧intervalの左片・右片を、それぞれ `parent_id=旧ID` の新規レコードとして作成する。
6. 削除でなければ入力区間を新規作成し、commitする。

復元は「対象mutationの後続操作がない」ことを確認してから、同mutationが作成した行を無効化し、同mutationが無効化した行を有効化する**逆mutation**として実装します。単に古い行の `is_active` を戻してはいけません。

## 移行

最初に必ず dry-run を行います。

```powershell
npm run migrate:legacy -- --apply-schema --source=study_intervals --dry-run
```

結果を確認後、`--dry-run` を外して実行します。`work_sessions` を使っている環境では `--source=work_sessions` を指定します。

- 旧テーブルは変更・削除しません。
- `work_sessions` は `session_pauses` を用い、pauseを除いた複数intervalとして移行します。
- `study_intervals` の `total_paused_time > 0` はpause位置が復元不能なので移行せず、`legacy_import_issues` に保留として記録します。この情報だけから正しい色付きタイムラインを復元することはできません。
- 未終了行も自動移行しません。切替直前に利用者へ `/stop` を促すか、個別に確認して処理してください。
- 旧データ内に重複がある場合、通常の移行は失敗してロールバックします。旧serial IDが作成・編集の時系列であることを確認できる場合のみ、`--resolve-overlaps=latest-id` を付けると「IDの大きい（後の）入力が勝つ」ルールで正規化して移行できます。
