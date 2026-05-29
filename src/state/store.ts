// 비트키퍼 — 인메모리 앱 상태 + 영속 + 간단한 pub/sub (브리프 §7)

import type { Song, Setlist, Settings, Session } from '../types.ts';
import { DEFAULT_SETTINGS } from '../types.ts';
import {
  loadSettings,
  saveSettingsDb,
  loadSongs,
  saveSong,
  deleteSongDb,
  loadSetlists,
  saveSetlist,
  deleteSetlistDb,
  loadSessions,
  saveSessionDb,
  deleteSessionDb,
} from './db.ts';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

type Listener = () => void;

class Store {
  settings: Settings = { ...DEFAULT_SETTINGS };
  songs: Song[] = [];
  setlists: Setlist[] = [];
  sessions: Session[] = [];
  activeSetlistId: string | null = null;

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  async init() {
    const [settings, songs, setlists, sessions] = await Promise.all([
      loadSettings(),
      loadSongs(),
      loadSetlists(),
      loadSessions(),
    ]);
    this.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    this.songs = songs;
    this.setlists = setlists;
    this.sessions = sessions;

    if (this.setlists.length === 0) await this.seedFirstRun();
    this.activeSetlistId = this.setlists[0]?.id ?? null;
    this.emit();
  }

  private async seedFirstRun() {
    const demo: Song = {
      id: uid(),
      name: '예시 곡',
      defaultBpm: 120,
      meter: '4/4',
      notes: '연주 화면에서 마이크를 켜고 템포를 확인해 보세요.',
    };
    const list: Setlist = { id: uid(), name: '내 셋리스트', songIds: [demo.id] };
    this.songs = [demo];
    this.setlists = [list];
    await Promise.all([saveSong(demo), saveSetlist(list)]);
  }

  // --- 설정 ---
  async saveSettings(partial: Partial<Settings>) {
    this.settings = { ...this.settings, ...partial };
    await saveSettingsDb(this.settings);
    this.emit();
  }

  // --- 곡 ---
  getSong(id: string | null | undefined): Song | undefined {
    return this.songs.find((s) => s.id === id);
  }
  async upsertSong(song: Song) {
    const i = this.songs.findIndex((s) => s.id === song.id);
    if (i >= 0) this.songs[i] = song;
    else this.songs.push(song);
    await saveSong(song);
    this.emit();
  }
  async deleteSong(id: string) {
    this.songs = this.songs.filter((s) => s.id !== id);
    // 셋리스트에서도 제거
    for (const sl of this.setlists) {
      if (sl.songIds.includes(id)) {
        sl.songIds = sl.songIds.filter((x) => x !== id);
        await saveSetlist(sl);
      }
    }
    await deleteSongDb(id);
    this.emit();
  }
  async duplicateSong(id: string): Promise<Song | undefined> {
    const src = this.getSong(id);
    if (!src) return;
    const copy: Song = {
      ...structuredClone(src),
      id: uid(),
      name: src.name + ' (복사)',
    };
    await this.upsertSong(copy);
    return copy;
  }

  // --- 셋리스트 ---
  getActiveSetlist(): Setlist | undefined {
    return this.setlists.find((s) => s.id === this.activeSetlistId) ?? this.setlists[0];
  }
  setActiveSetlist(id: string) {
    this.activeSetlistId = id;
    this.emit();
  }
  async upsertSetlist(list: Setlist) {
    const i = this.setlists.findIndex((s) => s.id === list.id);
    if (i >= 0) this.setlists[i] = list;
    else this.setlists.push(list);
    await saveSetlist(list);
    this.emit();
  }
  async createSetlist(name: string): Promise<Setlist> {
    const list: Setlist = { id: uid(), name: name || '새 셋리스트', songIds: [] };
    await this.upsertSetlist(list);
    this.activeSetlistId = list.id;
    this.emit();
    return list;
  }
  async deleteSetlist(id: string) {
    this.setlists = this.setlists.filter((s) => s.id !== id);
    if (this.activeSetlistId === id) this.activeSetlistId = this.setlists[0]?.id ?? null;
    await deleteSetlistDb(id);
    this.emit();
  }
  async addSongToSetlist(setlistId: string, songId: string) {
    const sl = this.setlists.find((s) => s.id === setlistId);
    if (!sl || sl.songIds.includes(songId)) return;
    sl.songIds = [...sl.songIds, songId];
    await saveSetlist(sl);
    this.emit();
  }
  async removeSongFromSetlist(setlistId: string, songId: string) {
    const sl = this.setlists.find((s) => s.id === setlistId);
    if (!sl) return;
    sl.songIds = sl.songIds.filter((x) => x !== songId);
    await saveSetlist(sl);
    this.emit();
  }
  async reorderSetlist(setlistId: string, from: number, to: number) {
    const sl = this.setlists.find((s) => s.id === setlistId);
    if (!sl) return;
    const ids = [...sl.songIds];
    if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return;
    const [m] = ids.splice(from, 1);
    ids.splice(to, 0, m);
    sl.songIds = ids;
    await saveSetlist(sl);
    this.emit();
  }
  async setSetlistOrder(setlistId: string, ids: string[]) {
    const sl = this.setlists.find((s) => s.id === setlistId);
    if (!sl) return;
    sl.songIds = ids;
    await saveSetlist(sl);
    this.emit();
  }

  // --- 세션 기록 (Phase 3) ---
  async saveSession(session: Session) {
    this.sessions.push(session);
    await saveSessionDb(session);
    this.emit();
  }
  getSessionsForSong(songId: string): Session[] {
    return this.sessions
      .filter((s) => s.songId === songId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }
  recentSessions(limit = 20): Session[] {
    return [...this.sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }
  async deleteSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    await deleteSessionDb(id);
    this.emit();
  }
}

export const store = new Store();
