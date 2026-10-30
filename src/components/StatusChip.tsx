import type { TaskSchedule } from '../schedule';

const LABELS = {
  done: 'готово',
  notstarted: 'не начата',
  ontrack: 'в графике',
  stalled: 'нет плана',
} as const;

export function StatusChip({ s, hasDeadline }: { s: TaskSchedule; hasDeadline: boolean }) {
  let text: string;
  let title = '';
  if (s.status === 'behind') {
    text = `+${s.slip} раб. дн.`;
    title = hasDeadline ? 'Прогноз позже дедлайна' : 'Прогноз позже планового окончания';
  } else if (s.status === 'ahead') {
    text = hasDeadline ? `запас ${-s.slip!} дн.` : `опережение ${-s.slip!} дн.`;
    title = hasDeadline ? 'Рабочих дней в запасе до дедлайна' : 'Прогноз раньше планового окончания';
  } else {
    text = LABELS[s.status];
    if (s.status === 'stalled') title = 'Нет часов в плане — задача не закончится';
  }
  return <span className={`chip chip-${s.status}`} title={title}>{text}</span>;
}
