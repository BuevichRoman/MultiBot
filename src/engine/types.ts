export interface EngineConfig {
  redis?: {
    host: string;
    port: number;
    password?: string;
  };
  schemasPath?: string; // relative to repo root, default: src/engine/schemas
  /**
   * При старте выполнить Redis FLUSHDB для текущей логической БД (состояния FSM + очереди задач).
   * По умолчанию true — не нужно восстанавливать сценарии после рестарта процесса.
   * Отключите (false), если в той же БД Redis живут другие сервисы.
   */
  flushRedisOnStartup?: boolean;
}

export type ActionParams = Record<string, any>;

export interface ActionDef {
  type: string;
  params?: ActionParams;
}

export interface TransitionDef {
  event: string;
  to: string;
  actions?: string[]; // action names to run on transition
}

export interface StateDef {
  id: string;
  entryActions?: string[];
  actions?: {
    [key: string]: Action
  };
  transitions?: TransitionDef[];
  validation?: ValidationRule;
  location?: LocationHandlingMapping
}

export interface Action {
  type: string;
  params?: Record<string, any>;
  description?: string;
  rule?: string;
  endpoint?: string;
  operation?: string;
  path?: string;
}

export interface Transition {
  event: string;
  to: string;
  actions: string[];
}

export interface State {
  id: string;
  entryActions?: string[];
  transitions: Transition[];
  validation?: ValidationRule;
  location?: LocationHandlingMapping;
  actions?: Record<string, Action>;
}

export interface ValidationMapping {
  event: string;          // Событие для этого значения
  data?: Record<string, any>;  // Опциональные данные для merge при переходе
}
export interface LocationHandlingMapping {
  accept: boolean,
  save:{
    latitude: {
      type: string,
      name: string
    },
    longitude: {
      type: string,
      name: string
    }
  },
  onSuccess: string,
  onError?: string
}

export interface ValidationRule {
  type?: 'choice' | 'regex' | 'range' | 'custom' | 'mapping';
  allowed?: string[];                    // Для choice
  pattern?: string;                       // Для regex
  min?: number;                           // Для range
  max?: number;                           // Для range
  mapping?: Record<string, ValidationMapping>;  // Маппинг значений на события
  errorEvent: string;                      // Событие при ошибке
  errorTo?: string;                        // Куда перейти при ошибке
  errorActions?: string[];                 // Действия при ошибке
  saveAs?: string;                         // Сохранить ввод как поле (поддерживает вложенные пути data.order.rate)
  saveFields?: Array<{ from: string; to: string }>; // Сохранить группы regex
  successEvent?: string;                   // Для choice/regex/range; для mapping не нужен
  /** main.options: разрешённые id опций (строки как во вводе); проверка в MainHandler + booking_comments */
  additionalOptionsAllowed?: string[];
  /** main.options: маппинг токена в id для merge в data.additionalOptions (как map в save для языков) */
  additionalOptionsTokenMap?: Record<string, number>;
}

export interface Flow {
  name: string;
  description?: string;
  states: Record<string, State>;
  actions: Record<string, Action>;
}

export interface FlowSelectionRule {
  name: string;
  condition: string;
  default?: boolean;
}

export interface TenantSchema {
  initialState: string;
  actions: Record<string, Action>;
  flowSelection: {
    strategy: 'first_match' | 'priority';
    flows: FlowSelectionRule[];
  };
  flows: Record<string, Flow>;
}
