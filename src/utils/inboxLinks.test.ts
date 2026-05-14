import { describe, expect, it } from 'vitest';
import {
  notificationTasksHref,
  parseInboxFocusFromNotificationId,
  tasksInboxHref,
  tasksPathFromNotificationId,
} from './inboxLinks';

describe('inboxLinks', () => {
  it('tasksInboxHref builds encoded focus query', () => {
    expect(tasksInboxHref('csr_stale', '12')).toBe('/tasks?focus=csr_stale%3A12');
  });

  it('tasksInboxHref falls back to /tasks when incomplete', () => {
    expect(tasksInboxHref()).toBe('/tasks');
    expect(tasksInboxHref('kind', '')).toBe('/tasks');
  });

  it('parseInboxFocusFromNotificationId handles kind:ref', () => {
    expect(parseInboxFocusFromNotificationId('finance_flag:abc-1')).toEqual({
      kind: 'finance_flag',
      refId: 'abc-1',
    });
    expect(parseInboxFocusFromNotificationId('nocolon')).toBeNull();
    expect(parseInboxFocusFromNotificationId(':only')).toBeNull();
  });

  it('tasksPathFromNotificationId matches parser', () => {
    expect(tasksPathFromNotificationId('x:y')).toBe('/tasks?focus=x%3Ay');
    expect(tasksPathFromNotificationId('bad')).toBe('/tasks');
  });

  it('notificationTasksHref prefers tasks_path', () => {
    expect(notificationTasksHref({ tasks_path: '/tasks?focus=a%3Ab' })).toBe('/tasks?focus=a%3Ab');
    expect(notificationTasksHref({ tasks_path: 'tasks?focus=a%3Ab' })).toBe('/tasks?focus=a%3Ab');
    expect(notificationTasksHref({ id: 'k:r' })).toBe('/tasks?focus=k%3Ar');
  });
});
