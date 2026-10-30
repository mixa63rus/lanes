import { useState } from 'react';
import { PALETTE, uid } from '../store';
import type { Role, Task } from '../types';

interface Props {
  roles: Role[];
  tasks: Task[];
  onSave: (roles: Role[]) => void;
  onClose: () => void;
}

const PRESETS = ['Frontend', 'Backend', 'QA', 'Дизайн', 'DevOps', 'Аналитика', 'Mobile'];

export function RolesDialog({ roles, tasks, onSave, onClose }: Props) {
  const [list, setList] = useState(roles);
  const patch = (id: string, p: Partial<Role>) => setList((l) => l.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = (name = '') =>
    setList((l) => [...l, { id: uid(), name, color: PALETTE[l.length % PALETTE.length] }]);
  const move = (i: number, dir: -1 | 1) =>
    setList((l) => {
      const next = [...l];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
  const remove = (r: Role) => {
    const n = tasks.filter((t) => t.roleId === r.id).length;
    if (n && !confirm(`У роли «${r.name}» ${n} задач(и). Удалить вместе с ними?`)) return;
    setList((l) => l.filter((x) => x.id !== r.id));
  };
  const unused = PRESETS.filter((p) => !list.some((r) => r.name.toLowerCase() === p.toLowerCase()));

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>Роли</h2>
        <div className="roles-list">
          {list.map((r, i) => (
            <div key={r.id} className="role-edit">
              <input type="color" value={r.color} onChange={(e) => patch(r.id, { color: e.target.value })} />
              <input value={r.name} placeholder="Название роли" autoFocus={!r.name}
                onChange={(e) => patch(r.id, { name: e.target.value })} />
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Выше">↑</button>
              <button className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} title="Ниже">↓</button>
              <button className="icon-btn danger" onClick={() => remove(r)} title="Удалить">✕</button>
            </div>
          ))}
        </div>
        <div className="presets">
          <button className="btn btn-ghost" onClick={() => add()}>+ Роль</button>
          {unused.map((p) => <button key={p} className="btn btn-chip" onClick={() => add(p)}>{p}</button>)}
        </div>
        <div className="dialog-actions">
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary"
            onClick={() => onSave(list.map((r) => ({ ...r, name: r.name.trim() || 'Без названия' })))}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
