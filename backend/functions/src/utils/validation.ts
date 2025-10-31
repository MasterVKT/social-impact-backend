import Joi from 'joi';
import { ValidationError } from './errors';

// New validation system interfaces
export interface ValidationSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  required?: string[];
  properties?: Record<string, ValidationSchema>;
  items?: ValidationSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: 'email' | 'uri' | 'date' | 'date-time' | 'uuid';
  enum?: any[];
  const?: any;
  additionalProperties?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorDetail[];
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
  value?: any;
}

export const commonSchemas = {
  uid: Joi.string().min(1).max(128).required(),
  email: Joi.string().email().required(),
  phoneNumber: Joi.string().pattern(/^\+[1-9]\d{1,14}$/),
  amount: Joi.number().integer().min(1000).max(10000000), // 10€ à 100k€ en centimes
  currency: Joi.string().valid('EUR').required(),
  country: Joi.string().length(2).uppercase().required(),
  language: Joi.string().valid('fr', 'en').required(),
  projectId: Joi.string().min(1).max(50).required(),
  userType: Joi.string().valid('contributor', 'creator', 'auditor').required(),
  kycStatus: Joi.string().valid('pending', 'approved', 'rejected', 'requires_action').required(),
  
  address: Joi.object({
    street: Joi.string().min(5).max(200).required(),
    city: Joi.string().min(2).max(100).required(),
    postalCode: Joi.string().min(3).max(10).required(),
    country: Joi.string().length(2).uppercase().required()
  }).required(),

  dateRange: Joi.object({
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().greater(Joi.ref('startDate')).required()
  }).required(),

  pagination: Joi.object({
    limit: Joi.number().integer().min(1).max(50).default(20),
    offset: Joi.number().integer().min(0).default(0),
    orderBy: Joi.string().optional(),
    orderDirection: Joi.string().valid('asc', 'desc').default('desc')
  }).optional()
};

export function validateWithJoi<T>(schema: Joi.ObjectSchema, data: unknown): T {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: true
  });

  if (error) {
    const firstError = error.details[0];
    throw new ValidationError(
      firstError.message,
      firstError.path.join('.')
    );
  }

  return value as T;
}

export function isValidEmail(email: string): boolean {
  const schema = Joi.string().email();
  const { error } = schema.validate(email);
  return !error;
}

export function isValidAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount >= 1000 && amount <= 10000000;
}

export function isValidProjectSlug(slug: string): boolean {
  const schema = Joi.string().pattern(/^[a-z0-9-]+$/).min(3).max(50);
  const { error } = schema.validate(slug);
  return !error;
}

export function generateProjectSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export function calculateFees(amount: number): { platform: number; audit: number; stripe: number; total: number } {
  const platformFee = Math.round(amount * 0.05); // 5%
  const auditFee = Math.round(amount * 0.03); // 3%
  const stripeFee = Math.round(amount * 0.029 + 30); // ~2.9% + 0.30€
  
  return {
    platform: platformFee,
    audit: auditFee,
    stripe: stripeFee,
    total: platformFee + auditFee + stripeFee
  };
}

export function isValidIBAN(iban: string): boolean {
  const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}([A-Z0-9]?){0,16}$/;
  if (!ibanRegex.test(iban.replace(/\s/g, ''))) return false;
  
  // IBAN checksum validation (basic)
  const cleanIban = iban.replace(/\s/g, '');
  const rearranged = cleanIban.substring(4) + cleanIban.substring(0, 4);
  const numericString = rearranged.replace(/[A-Z]/g, (char) => (char.charCodeAt(0) - 55).toString());
  
  let remainder = '';
  for (let i = 0; i < numericString.length; i += 7) {
    remainder = String(parseInt(remainder + numericString.substring(i, i + 7)) % 97);
  }
  
  return parseInt(remainder) === 1;
}

export const projectValidation = {
  title: Joi.string().min(10).max(100).required(),
  shortDescription: Joi.string().min(50).max(300).required(),
  fullDescription: Joi.string().min(200).max(5000).required(),
  category: Joi.string().valid('environment', 'education', 'health', 'community', 'innovation').required(),
  fundingGoal: commonSchemas.amount.required(),
  duration: Joi.number().integer().min(30).max(90).required(), // 30-90 jours
  location: Joi.object({
    city: Joi.string().min(2).max(100).required(),
    country: commonSchemas.country.required(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required()
    }).optional()
  }).required(),
  milestones: Joi.array().items(
    Joi.object({
      title: Joi.string().min(5).max(100).required(),
      description: Joi.string().min(20).max(500).required(),
      targetDate: Joi.date().iso().greater('now').required(),
      fundingPercentage: Joi.number().min(1).max(100).required(),
      deliverables: Joi.array().items(Joi.string().min(5).max(200)).min(1).required()
    })
  ).min(1).max(5).required()
};

// New lightweight validation engine for user API
export function validateSchema(data: any, schema: ValidationSchema): ValidationResult {
  const errors: ValidationErrorDetail[] = [];

  try {
    validateValue(data, schema, '', errors);
  } catch (error) {
    errors.push({
      field: 'root',
      message: `Validation error: ${(error as Error).message}`
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateValue(value: any, schema: ValidationSchema, path: string, errors: ValidationErrorDetail[]): void {
  // Handle null/undefined values
  if (value === null || value === undefined) {
    if (schema.required && schema.required.length > 0) {
      errors.push({
        field: path,
        message: 'Value is required but not provided',
        value
      });
    }
    return;
  }

  // Type validation
  if (!validateType(value, schema.type)) {
    errors.push({
      field: path,
      message: `Expected type ${schema.type} but got ${typeof value}`,
      value
    });
    return;
  }

  // Type-specific validations
  switch (schema.type) {
    case 'object':
      validateObject(value, schema, path, errors);
      break;
    case 'array':
      validateArray(value, schema, path, errors);
      break;
    case 'string':
      validateString(value, schema, path, errors);
      break;
    case 'number':
      validateNumber(value, schema, path, errors);
      break;
  }

  // Enum validation
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({
      field: path,
      message: `Value must be one of: ${schema.enum.join(', ')}`,
      value
    });
  }

  // Const validation
  if (schema.const !== undefined && value !== schema.const) {
    errors.push({
      field: path,
      message: `Value must be exactly: ${schema.const}`,
      value
    });
  }
}

function validateType(value: any, type: ValidationSchema['type']): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

function validateObject(value: any, schema: ValidationSchema, path: string, errors: ValidationErrorDetail[]): void {
  if (!schema.properties) return;

  // Check required fields
  if (schema.required) {
    for (const requiredField of schema.required) {
      if (!(requiredField in value)) {
        errors.push({
          field: `${path}.${requiredField}`,
          message: 'Required field is missing',
          value: undefined
        });
      }
    }
  }

  // Validate properties
  for (const [propName, propSchema] of Object.entries(schema.properties)) {
    if (propName in value) {
      const propPath = path ? `${path}.${propName}` : propName;
      validateValue(value[propName], propSchema, propPath, errors);
    }
  }

  // Check for additional properties
  if (schema.additionalProperties === false) {
    const allowedProps = Object.keys(schema.properties);
    for (const propName of Object.keys(value)) {
      if (!allowedProps.includes(propName)) {
        errors.push({
          field: `${path}.${propName}`,
          message: 'Additional property not allowed',
          value: value[propName]
        });
      }
    }
  }
}

function validateArray(value: any[], schema: ValidationSchema, path: string, errors: ValidationErrorDetail[]): void {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({
      field: path,
      message: `Array must have at least ${schema.minLength} items`,
      value: value.length
    });
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({
      field: path,
      message: `Array must have at most ${schema.maxLength} items`,
      value: value.length
    });
  }

  if (schema.items) {
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      validateValue(item, schema.items!, itemPath, errors);
    });
  }
}

function validateString(value: string, schema: ValidationSchema, path: string, errors: ValidationErrorDetail[]): void {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({
      field: path,
      message: `String must be at least ${schema.minLength} characters long`,
      value: value.length
    });
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({
      field: path,
      message: `String must be at most ${schema.maxLength} characters long`,
      value: value.length
    });
  }

  if (schema.pattern) {
    const regex = new RegExp(schema.pattern);
    if (!regex.test(value)) {
      errors.push({
        field: path,
        message: `String does not match required pattern: ${schema.pattern}`,
        value
      });
    }
  }

  if (schema.format) {
    if (!validateFormat(value, schema.format)) {
      errors.push({
        field: path,
        message: `String does not match required format: ${schema.format}`,
        value
      });
    }
  }
}

function validateNumber(value: number, schema: ValidationSchema, path: string, errors: ValidationErrorDetail[]): void {
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push({
      field: path,
      message: `Number must be at least ${schema.minimum}`,
      value
    });
  }

  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push({
      field: path,
      message: `Number must be at most ${schema.maximum}`,
      value
    });
  }
}

function validateFormat(value: string, format: string): boolean {
  switch (format) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'uri':
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value));
    case 'date-time':
      return !isNaN(Date.parse(value));
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    default:
      return true;
  }
}