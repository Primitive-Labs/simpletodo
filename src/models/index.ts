// Barrel file for all models - add new model exports here
// When a new model is created, export it from this file to auto-register it

export { UserPref } from "./UserPref";

// Import all model classes and export as an array for easy registration
import { UserPref } from "./UserPref";

// Add new models to this array as they are created
export const allModels: unknown[] = [UserPref];
