import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { auditLogger } from '../monitoring/auditLogger';

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

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

class ValidationEngine {
  validateSchema(data: any, schema: ValidationSchema, path: string = ''): ValidationResult {
    const errors: ValidationError[] = [];

    try {
      this.validateValue(data, schema, path, errors);
    } catch (error) {
      errors.push({
        field: path || 'root',
        message: `Validation error: ${(error as Error).message}`
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private validateValue(value: any, schema: ValidationSchema, path: string, errors: ValidationError[]): void {
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
    if (!this.validateType(value, schema.type)) {
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
        this.validateObject(value, schema, path, errors);
        break;
      case 'array':
        this.validateArray(value, schema, path, errors);
        break;
      case 'string':
        this.validateString(value, schema, path, errors);
        break;
      case 'number':
        this.validateNumber(value, schema, path, errors);
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

  private validateType(value: any, type: ValidationSchema['type']): boolean {
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

  private validateObject(value: any, schema: ValidationSchema, path: string, errors: ValidationError[]): void {
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
        this.validateValue(value[propName], propSchema, propPath, errors);
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

  private validateArray(value: any[], schema: ValidationSchema, path: string, errors: ValidationError[]): void {
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
        this.validateValue(item, schema.items!, itemPath, errors);
      });
    }
  }

  private validateString(value: string, schema: ValidationSchema, path: string, errors: ValidationError[]): void {
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
      if (!this.validateFormat(value, schema.format)) {
        errors.push({
          field: path,
          message: `String does not match required format: ${schema.format}`,
          value
        });
      }
    }
  }

  private validateNumber(value: number, schema: ValidationSchema, path: string, errors: ValidationError[]): void {
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

  private validateFormat(value: string, format: string): boolean {
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
}

const validationEngine = new ValidationEngine();

// Predefined schemas
const schemas: Record<string, ValidationSchema> = {
  userCreate: {
    type: 'object',
    required: ['email', 'password', 'profile', 'acceptedTerms', 'acceptedPrivacy'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      profile: {
        type: 'object',
        required: ['firstName', 'lastName'],
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 50 },
          lastName: { type: 'string', minLength: 1, maxLength: 50 },
          displayName: { type: 'string', maxLength: 100 }
        },
        additionalProperties: false
      },
      preferences: {
        type: 'object',
        properties: {
          notifications: {
            type: 'object',
            properties: {
              email: { type: 'boolean' },
              push: { type: 'boolean' },
              frequency: { enum: ['immediate', 'daily', 'weekly'] }
            }
          },
          privacy: {
            type: 'object',
            properties: {
              profileVisibility: { enum: ['public', 'private', 'supporters_only'] },
              showDonations: { type: 'boolean' },
              showLocation: { type: 'boolean' }
            }
          },
          language: { type: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$' },
          timezone: { type: 'string' },
          currency: { type: 'string', pattern: '^[A-Z]{3}$' }
        }
      },
      acceptedTerms: { type: 'boolean', const: true },
      acceptedPrivacy: { type: 'boolean', const: true }
    },
    additionalProperties: false
  },

  userUpdate: {
    type: 'object',
    properties: {
      profile: {
        type: 'object',
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 50 },
          lastName: { type: 'string', minLength: 1, maxLength: 50 },
          displayName: { type: 'string', maxLength: 100 },
          bio: { type: 'string', maxLength: 500 },
          location: {
            type: 'object',
            properties: {
              city: { type: 'string', maxLength: 100 },
              country: { type: 'string', maxLength: 100 },
              coordinates: {
                type: 'object',
                properties: {
                  lat: { type: 'number', minimum: -90, maximum: 90 },
                  lng: { type: 'number', minimum: -180, maximum: 180 }
                }
              }
            }
          },
          website: { type: 'string', format: 'uri' },
          socialLinks: {
            type: 'object',
            properties: {
              twitter: { type: 'string', format: 'uri' },
              linkedin: { type: 'string', format: 'uri' },
              github: { type: 'string', format: 'uri' }
            }
          }
        }
      },
      preferences: {
        type: 'object',
        properties: {
          notifications: {
            type: 'object',
            properties: {
              email: { type: 'boolean' },
              push: { type: 'boolean' },
              frequency: { enum: ['immediate', 'daily', 'weekly'] }
            }
          },
          privacy: {
            type: 'object',
            properties: {
              profileVisibility: { enum: ['public', 'private', 'supporters_only'] },
              showDonations: { type: 'boolean' },
              showLocation: { type: 'boolean' }
            }
          },
          language: { type: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$' },
          timezone: { type: 'string' },
          currency: { type: 'string', pattern: '^[A-Z]{3}$' }
        }
      }
    },
    additionalProperties: false
  },

  userRoleUpdate: {
    type: 'object',
    required: ['roles'],
    properties: {
      roles: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['user', 'creator', 'moderator', 'auditor', 'support', 'admin']
        },
        minLength: 1
      },
      permissions: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    additionalProperties: false
  },

  projectCreate: {
    type: 'object',
    required: ['title', 'description', 'category', 'fundingGoal', 'currency', 'duration'],
    properties: {
      title: { type: 'string', minLength: 5, maxLength: 100 },
      description: { type: 'string', minLength: 50, maxLength: 5000 },
      category: {
        type: 'string',
        enum: ['education', 'health', 'environment', 'poverty', 'disaster_relief', 'community', 'technology', 'other']
      },
      fundingGoal: { type: 'number', minimum: 100, maximum: 1000000 },
      currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      duration: { type: 'number', minimum: 7, maximum: 365 },
      tags: {
        type: 'array',
        items: { type: 'string', maxLength: 30 },
        maxLength: 10
      },
      location: {
        type: 'object',
        properties: {
          country: { type: 'string', maxLength: 100 },
          region: { type: 'string', maxLength: 100 },
          city: { type: 'string', maxLength: 100 }
        }
      }
    },
    additionalProperties: false
  },

  projectCreate: {
    type: 'object',
    required: ['title', 'shortDescription', 'fullDescription', 'category', 'fundingGoal', 'currency', 'duration', 'startDate', 'location', 'milestones'],
    properties: {
      title: { type: 'string', minLength: 10, maxLength: 100 },
      shortDescription: { type: 'string', minLength: 50, maxLength: 300 },
      fullDescription: { type: 'string', minLength: 200, maxLength: 5000 },
      category: { 
        type: 'string', 
        enum: ['education', 'health', 'environment', 'poverty', 'disaster_relief', 'community', 'technology', 'other'] 
      },
      fundingGoal: { type: 'number', minimum: 100, maximum: 1000000 },
      currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      duration: { type: 'number', minimum: 7, maximum: 365 },
      startDate: { type: 'string', format: 'date-time' },
      location: {
        type: 'object',
        required: ['country'],
        properties: {
          country: { type: 'string', minLength: 2, maxLength: 100 },
          region: { type: 'string', maxLength: 100 },
          city: { type: 'string', maxLength: 100 },
          coordinates: {
            type: 'object',
            properties: {
              lat: { type: 'number', minimum: -90, maximum: 90 },
              lng: { type: 'number', minimum: -180, maximum: 180 }
            }
          }
        }
      },
      milestones: {
        type: 'array',
        minLength: 1,
        maxLength: 10,
        items: {
          type: 'object',
          required: ['title', 'description', 'targetDate', 'fundingPercentage', 'deliverables'],
          properties: {
            title: { type: 'string', minLength: 5, maxLength: 100 },
            description: { type: 'string', minLength: 20, maxLength: 500 },
            targetDate: { type: 'string', format: 'date-time' },
            fundingPercentage: { type: 'number', minimum: 1, maximum: 100 },
            deliverables: {
              type: 'array',
              minLength: 1,
              maxLength: 10,
              items: { type: 'string', minLength: 5, maxLength: 200 }
            }
          }
        }
      },
      tags: {
        type: 'array',
        maxLength: 10,
        items: { type: 'string', minLength: 2, maxLength: 30 }
      }
    },
    additionalProperties: false
  },

  projectUpdate: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 10, maxLength: 100 },
      shortDescription: { type: 'string', minLength: 50, maxLength: 300 },
      fullDescription: { type: 'string', minLength: 200, maxLength: 5000 },
      category: { 
        type: 'string', 
        enum: ['education', 'health', 'environment', 'poverty', 'disaster_relief', 'community', 'technology', 'other'] 
      },
      location: {
        type: 'object',
        properties: {
          country: { type: 'string', minLength: 2, maxLength: 100 },
          region: { type: 'string', maxLength: 100 },
          city: { type: 'string', maxLength: 100 },
          coordinates: {
            type: 'object',
            properties: {
              lat: { type: 'number', minimum: -90, maximum: 90 },
              lng: { type: 'number', minimum: -180, maximum: 180 }
            }
          }
        }
      },
      tags: {
        type: 'array',
        maxLength: 10,
        items: { type: 'string', minLength: 2, maxLength: 30 }
      }
    },
    additionalProperties: false
  },

  donationCreate: {
    type: 'object',
    required: ['projectId', 'amount', 'currency'],
    properties: {
      projectId: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' },
      amount: { type: 'number', minimum: 1, maximum: 100000 },
      currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      anonymous: { type: 'boolean' },
      message: { type: 'string', maxLength: 500 },
      recurring: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          frequency: { enum: ['weekly', 'monthly', 'quarterly'] },
          endDate: { type: 'string', format: 'date' }
        }
      }
    },
    additionalProperties: false
  },

  donationProcess: {
    type: 'object',
    required: ['paymentIntentId'],
    properties: {
      paymentIntentId: { type: 'string', minLength: 10, maxLength: 200 },
      paymentMethodId: { type: 'string', minLength: 10, maxLength: 200 }
    },
    additionalProperties: false
  },

  donationRefund: {
    type: 'object',
    properties: {
      reason: { type: 'string', minLength: 5, maxLength: 500 }
    },
    additionalProperties: false
  }
};

export function validateSchema(data: any, schema: ValidationSchema): ValidationResult {
  return validationEngine.validateSchema(data, schema);
}

export function validationMiddleware(schemaName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schema = schemas[schemaName];
      if (!schema) {
        logger.error('Validation schema not found', new Error('Schema not found'), { schemaName });
        res.status(500).json({
          error: 'Internal validation error',
          message: 'Validation schema not configured'
        });
        return;
      }

      const validation = validateSchema(req.body, schema);

      if (!validation.valid) {
        // Log validation failure
        await auditLogger.logUserAction(
          (req as any).user?.uid || 'anonymous',
          'access',
          'endpoint',
          req.path,
          'failure',
          {
            service: 'validation-middleware',
            endpoint: req.path,
            method: req.method,
            reason: 'validation_failed'
          }
        );

        res.status(400).json({
          error: 'Validation failed',
          message: 'Request data does not meet requirements',
          details: validation.errors.map(err => ({
            field: err.field,
            message: err.message
          }))
        });

        logger.warn('Request validation failed', {
          endpoint: req.path,
          method: req.method,
          schemaName,
          errors: validation.errors,
          userId: (req as any).user?.uid
        });

        return;
      }

      next();

    } catch (error) {
      logger.error('Validation middleware error', error as Error, {
        endpoint: req.path,
        method: req.method,
        schemaName
      });

      res.status(500).json({
        error: 'Validation error',
        message: 'An error occurred during request validation'
      });
    }
  };
}

// Custom validation functions
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (password.length > 128) {
    errors.push('Password must be at most 128 characters long');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validatePhoneNumber(phone: string): boolean {
  // Basic international phone number validation
  return /^\+?[1-9]\d{1,14}$/.test(phone.replace(/[\s\-\(\)]/g, ''));
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeInput(input: string): string {
  // Remove potentially dangerous characters
  return input
    .replace(/[<>]/g, '') // Remove HTML brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .trim();
}

export function validateAndSanitize(data: any, schema: ValidationSchema): {
  valid: boolean;
  errors: ValidationError[];
  sanitized?: any;
} {
  const validation = validateSchema(data, schema);
  
  if (!validation.valid) {
    return validation;
  }

  // Perform sanitization
  const sanitized = sanitizeObject(data);

  return {
    valid: true,
    errors: [],
    sanitized
  };
}

function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (typeof obj === 'object' && obj !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }

  return obj;
}

export { schemas, ValidationEngine };