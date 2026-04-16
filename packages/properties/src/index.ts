// Property schema
export type {
  PropertyDescriptor,
  PropertyGroup,
  PropertySchema,
  PropertyType,
} from './property-schema.js';

// Property service (IPropertyService is both an interface and a ServiceIdentifier value)
export type { PropertyChangeEvent } from './property-service.js';
export { IPropertyService, PropertyService } from './property-service.js';

// Selection service (ISelectionService is both an interface and a ServiceIdentifier value)
export { ISelectionService, SelectionService } from './selection-service.js';

// Plugin
export { PropertiesPlugin } from './properties-plugin.js';
