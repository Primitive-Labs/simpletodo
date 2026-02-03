// Barrel file for all models - add new model exports here
// When a new model is created, export it from this file to auto-register it

export { UserPref } from "./UserPref";
export { TodoList } from "./TodoList";
export { TodoItem } from "./TodoItem";

// Import all model classes and export as an array for easy registration
import { UserPref } from "./UserPref";
import { TodoList } from "./TodoList";
import { TodoItem } from "./TodoItem";

// Add new models to this array as they are created
export const allModels: unknown[] = [UserPref, TodoList, TodoItem];
