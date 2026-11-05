// Results passed between chapters during one visit (nothing is stored on a
// server). For example, the terrain model matched in Chapter 6 can be used
// for the orthophoto in Chapter 7.
export const session = {
  dtm: null,        // { grid, label }
  orientations: {}, // photo id -> exterior orientation computed by the student
  listeners: new Set(),
  set(key, value) {
    session[key] = value;
    session.listeners.forEach(f => f(key, value));
  },
};
