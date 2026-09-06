"""Exercise additive V1 meta keys on a copy of the actual M10 database; never alter the original."""
import sqlite3, os, json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
source = Path(os.environ['APPDATA']) / 'local.tft-strategist.desktop' / 'strategist.db'
target = root / 'artifacts/m10-validation/meta-storage-upgrade.db'
original = sqlite3.connect('file:' + str(source) + '?mode=ro', uri=True)
copy = sqlite3.connect(target)
original.backup(copy)
tables = [r[0] for r in copy.execute("select name from sqlite_master where type='table'")]
before = {t: copy.execute('select * from "' + t.replace('"','""') + '"').fetchall() for t in tables}
for key, value in [('meta-membership:v1:upgrade-test', {'version':1,'ids':['fixture-only']}),('meta-classified:v1:upgrade-test',[]),('meta-current:v1',{'version':1,'testOnly':True})]:
    copy.execute('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value',(key,json.dumps(value)))
copy.commit()
for table, rows in before.items():
    after = copy.execute('select * from "' + table.replace('"','""') + '"').fetchall()
    assert all(row in after for row in rows), table
assert copy.execute('pragma integrity_check').fetchone()[0] == 'ok'
assert original.execute('pragma integrity_check').fetchone()[0] == 'ok'
result = {'schemaMigrationsAdded':0,'storageContractVersion':1,'tablesPreserved':len(tables),'existingRowsPreserved':sum(map(len,before.values())),'integrity':'ok','originalDatabase':'read-only'}
(root/'artifacts/m10-validation/meta-storage-upgrade.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result))
copy.close(); original.close()
