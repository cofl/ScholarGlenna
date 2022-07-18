/* eslint-disable */

import { AllTypesProps, ReturnTypes, Ops } from './const';
//import fetch, { Response } from 'node-fetch';
import WebSocket from 'ws';
export const HOST = "http://hasura:8080/v1/graphql"


export const HEADERS = {}
export const apiSubscription = (options: chainOptions) => (query: string) => {
  try {
    const queryString = options[0] + '?query=' + encodeURIComponent(query);
    const wsString = queryString.replace('http', 'ws');
    const host = (options.length > 1 && options[1]?.websocket?.[0]) || wsString;
    const webSocketOptions = options[1]?.websocket || [host];
    const ws = new WebSocket(...webSocketOptions);
    return {
      ws,
      on: (e: (args: any) => void) => {
        ws.onmessage = (event: any) => {
          if (event.data) {
            const parsed = JSON.parse(event.data);
            const data = parsed.data;
            return e(data);
          }
        };
      },
      off: (e: (args: any) => void) => {
        ws.onclose = e;
      },
      error: (e: (args: any) => void) => {
        ws.onerror = e;
      },
      open: (e: () => void) => {
        ws.onopen = e;
      },
    };
  } catch {
    throw new Error('No websockets implemented');
  }
};
const handleFetchResponse = (response: Response): Promise<GraphQLResponse> => {
  if (!response.ok) {
    return new Promise((_, reject) => {
      response
        .text()
        .then((text) => {
          try {
            reject(JSON.parse(text));
          } catch (err) {
            reject(text);
          }
        })
        .catch(reject);
    });
  }
  return response.json();
};

export const apiFetch =
  (options: fetchOptions) =>
  (query: string, variables: Record<string, unknown> = {}) => {
    const fetchOptions = options[1] || {};
    if (fetchOptions.method && fetchOptions.method === 'GET') {
      return fetch(`${options[0]}?query=${encodeURIComponent(query)}`, fetchOptions)
        .then(handleFetchResponse)
        .then((response: GraphQLResponse) => {
          if (response.errors) {
            throw new GraphQLError(response);
          }
          return response.data;
        });
    }
    return fetch(`${options[0]}`, {
      body: JSON.stringify({ query, variables }),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      ...fetchOptions,
    })
      .then(handleFetchResponse)
      .then((response: GraphQLResponse) => {
        if (response.errors) {
          throw new GraphQLError(response);
        }
        return response.data;
      });
  };

export const InternalsBuildQuery = ({
  ops,
  props,
  returns,
  options,
  scalars,
}: {
  props: AllTypesPropsType;
  returns: ReturnTypesType;
  ops: Operations;
  options?: OperationOptions;
  scalars?: ScalarDefinition;
}) => {
  const ibb = (
    k: string,
    o: InputValueType | VType,
    p = '',
    root = true,
    vars: Array<{ name: string; graphQLType: string }> = [],
  ): string => {
    const keyForPath = purifyGraphQLKey(k);
    const newPath = [p, keyForPath].join(SEPARATOR);
    if (!o) {
      return '';
    }
    if (typeof o === 'boolean' || typeof o === 'number') {
      return k;
    }
    if (typeof o === 'string') {
      return `${k} ${o}`;
    }
    if (Array.isArray(o)) {
      const args = InternalArgsBuilt({
        props,
        returns,
        ops,
        scalars,
        vars,
      })(o[0], newPath);
      return `${ibb(args ? `${k}(${args})` : k, o[1], p, false, vars)}`;
    }
    if (k === '__alias') {
      return Object.entries(o)
        .map(([alias, objectUnderAlias]) => {
          if (typeof objectUnderAlias !== 'object' || Array.isArray(objectUnderAlias)) {
            throw new Error(
              'Invalid alias it should be __alias:{ YOUR_ALIAS_NAME: { OPERATION_NAME: { ...selectors }}}',
            );
          }
          const operationName = Object.keys(objectUnderAlias)[0];
          const operation = objectUnderAlias[operationName];
          return ibb(`${alias}:${operationName}`, operation, p, false, vars);
        })
        .join('\n');
    }
    const hasOperationName = root && options?.operationName ? ' ' + options.operationName : '';
    const keyForDirectives = o.__directives ?? '';
    const query = `{${Object.entries(o)
      .filter(([k]) => k !== '__directives')
      .map((e) => ibb(...e, [p, `field<>${keyForPath}`].join(SEPARATOR), false, vars))
      .join('\n')}}`;
    if (!root) {
      return `${k} ${keyForDirectives}${hasOperationName} ${query}`;
    }
    const varsString = vars.map((v) => `${v.name}: ${v.graphQLType}`).join(', ');
    return `${k} ${keyForDirectives}${hasOperationName}${varsString ? `(${varsString})` : ''} ${query}`;
  };
  return ibb;
};

export const Thunder =
  (fn: FetchFunction) =>
  <O extends keyof typeof Ops, SCLR extends ScalarDefinition, R extends keyof ValueTypes = GenericOperation<O>>(
    operation: O,
    graphqlOptions?: ThunderGraphQLOptions<SCLR>,
  ) =>
  <Z extends ValueTypes[R]>(o: Z | ValueTypes[R], ops?: OperationOptions & { variables?: Record<string, unknown> }) =>
    fn(
      Zeus(operation, o, {
        operationOptions: ops,
        scalars: graphqlOptions?.scalars,
      }),
      ops?.variables,
    ).then((data) => {
      if (graphqlOptions?.scalars) {
        return decodeScalarsInResponse({
          response: data,
          initialOp: operation,
          initialZeusQuery: o as VType,
          returns: ReturnTypes,
          scalars: graphqlOptions.scalars,
          ops: Ops,
        });
      }
      return data;
    }) as Promise<InputType<GraphQLTypes[R], Z, SCLR>>;

export const Chain = (...options: chainOptions) => Thunder(apiFetch(options));

export const SubscriptionThunder =
  (fn: SubscriptionFunction) =>
  <O extends keyof typeof Ops, SCLR extends ScalarDefinition, R extends keyof ValueTypes = GenericOperation<O>>(
    operation: O,
    graphqlOptions?: ThunderGraphQLOptions<SCLR>,
  ) =>
  <Z extends ValueTypes[R]>(o: Z | ValueTypes[R], ops?: OperationOptions & { variables?: ExtractVariables<Z> }) => {
    const returnedFunction = fn(
      Zeus(operation, o, {
        operationOptions: ops,
        scalars: graphqlOptions?.scalars,
      }),
    ) as SubscriptionToGraphQL<Z, GraphQLTypes[R], SCLR>;
    if (returnedFunction?.on && graphqlOptions?.scalars) {
      const wrapped = returnedFunction.on;
      returnedFunction.on = (fnToCall: (args: InputType<GraphQLTypes[R], Z, SCLR>) => void) =>
        wrapped((data: InputType<GraphQLTypes[R], Z, SCLR>) => {
          if (graphqlOptions?.scalars) {
            return fnToCall(
              decodeScalarsInResponse({
                response: data,
                initialOp: operation,
                initialZeusQuery: o as VType,
                returns: ReturnTypes,
                scalars: graphqlOptions.scalars,
                ops: Ops,
              }),
            );
          }
          return fnToCall(data);
        });
    }
    return returnedFunction;
  };

export const Subscription = (...options: chainOptions) => SubscriptionThunder(apiSubscription(options));
export const Zeus = <
  Z extends ValueTypes[R],
  O extends keyof typeof Ops,
  R extends keyof ValueTypes = GenericOperation<O>,
>(
  operation: O,
  o: Z | ValueTypes[R],
  ops?: {
    operationOptions?: OperationOptions;
    scalars?: ScalarDefinition;
  },
) =>
  InternalsBuildQuery({
    props: AllTypesProps,
    returns: ReturnTypes,
    ops: Ops,
    options: ops?.operationOptions,
    scalars: ops?.scalars,
  })(operation, o as VType);

export const ZeusSelect = <T>() => ((t: unknown) => t) as SelectionFunction<T>;

export const Selector = <T extends keyof ValueTypes>(key: T) => key && ZeusSelect<ValueTypes[T]>();

export const TypeFromSelector = <T extends keyof ValueTypes>(key: T) => key && ZeusSelect<ValueTypes[T]>();
export const Gql = Chain(HOST, {
  headers: {
    'Content-Type': 'application/json',
    ...HEADERS,
  },
});

export const ZeusScalars = ZeusSelect<ScalarCoders>();

export const decodeScalarsInResponse = <O extends Operations>({
  response,
  scalars,
  returns,
  ops,
  initialZeusQuery,
  initialOp,
}: {
  ops: O;
  response: any;
  returns: ReturnTypesType;
  scalars?: Record<string, ScalarResolver | undefined>;
  initialOp: keyof O;
  initialZeusQuery: InputValueType | VType;
}) => {
  if (!scalars) {
    return response;
  }
  const builder = PrepareScalarPaths({
    ops,
    returns,
  });

  const scalarPaths = builder(initialOp as string, ops[initialOp], initialZeusQuery);
  if (scalarPaths) {
    const r = traverseResponse({ scalarPaths, resolvers: scalars })('Query', response, ['Query']);
    return r;
  }
  return response;
};

export const traverseResponse = ({
  resolvers,
  scalarPaths,
}: {
  scalarPaths: { [x: string]: `scalar.${string}` };
  resolvers: {
    [x: string]: ScalarResolver | undefined;
  };
}) => {
  const ibb = (k: string, o: InputValueType | VType, p: string[] = []): unknown => {
    if (Array.isArray(o)) {
      return o.map((eachO) => ibb(k, eachO, p));
    }
    const scalarPathString = p.join(SEPARATOR);
    const currentScalarString = scalarPaths[scalarPathString];
    if (currentScalarString) {
      const currentDecoder = resolvers[currentScalarString.split('.')[1]]?.decode;
      if (currentDecoder) {
        return currentDecoder(o);
      }
    }
    if (typeof o === 'boolean' || typeof o === 'number' || typeof o === 'string' || !o) {
      return o;
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, ibb(k, v, [...p, purifyGraphQLKey(k)])]));
  };
  return ibb;
};

export type AllTypesPropsType = {
  [x: string]:
    | undefined
    | `scalar.${string}`
    | 'enum'
    | {
        [x: string]:
          | undefined
          | string
          | {
              [x: string]: string | undefined;
            };
      };
};

export type ReturnTypesType = {
  [x: string]:
    | {
        [x: string]: string | undefined;
      }
    | `scalar.${string}`
    | undefined;
};
export type InputValueType = {
  [x: string]: undefined | boolean | string | number | [any, undefined | boolean | InputValueType] | InputValueType;
};
export type VType =
  | undefined
  | boolean
  | string
  | number
  | [any, undefined | boolean | InputValueType]
  | InputValueType;

export type PlainType = boolean | number | string | null | undefined;
export type ZeusArgsType =
  | PlainType
  | {
      [x: string]: ZeusArgsType;
    }
  | Array<ZeusArgsType>;

export type Operations = Record<string, string>;

export type VariableDefinition = {
  [x: string]: unknown;
};

export const SEPARATOR = '|';

export type fetchOptions = Parameters<typeof fetch>;
type websocketOptions = typeof WebSocket extends new (...args: infer R) => WebSocket ? R : never;
export type chainOptions = [fetchOptions[0], fetchOptions[1] & { websocket?: websocketOptions }] | [fetchOptions[0]];
export type FetchFunction = (query: string, variables?: Record<string, unknown>) => Promise<any>;
export type SubscriptionFunction = (query: string) => any;
type NotUndefined<T> = T extends undefined ? never : T;
export type ResolverType<F> = NotUndefined<F extends [infer ARGS, any] ? ARGS : undefined>;

export type OperationOptions = {
  operationName?: string;
};

export type ScalarCoder = Record<string, (s: unknown) => string>;

export interface GraphQLResponse {
  data?: Record<string, any>;
  errors?: Array<{
    message: string;
  }>;
}
export class GraphQLError extends Error {
  constructor(public response: GraphQLResponse) {
    super('');
    console.error(response);
  }
  toString() {
    return 'GraphQL Response Error';
  }
}
export type GenericOperation<O> = O extends keyof typeof Ops ? typeof Ops[O] : never;
export type ThunderGraphQLOptions<SCLR extends ScalarDefinition> = {
  scalars?: SCLR | ScalarCoders;
};

const ExtractScalar = (mappedParts: string[], returns: ReturnTypesType): `scalar.${string}` | undefined => {
  if (mappedParts.length === 0) {
    return;
  }
  const oKey = mappedParts[0];
  const returnP1 = returns[oKey];
  if (typeof returnP1 === 'object') {
    const returnP2 = returnP1[mappedParts[1]];
    if (returnP2) {
      return ExtractScalar([returnP2, ...mappedParts.slice(2)], returns);
    }
    return undefined;
  }
  return returnP1 as `scalar.${string}` | undefined;
};

export const PrepareScalarPaths = ({ ops, returns }: { returns: ReturnTypesType; ops: Operations }) => {
  const ibb = (
    k: string,
    originalKey: string,
    o: InputValueType | VType,
    p: string[] = [],
    pOriginals: string[] = [],
    root = true,
  ): { [x: string]: `scalar.${string}` } | undefined => {
    if (!o) {
      return;
    }
    if (typeof o === 'boolean' || typeof o === 'number' || typeof o === 'string') {
      const extractionArray = [...pOriginals, originalKey];
      const isScalar = ExtractScalar(extractionArray, returns);
      if (isScalar?.startsWith('scalar')) {
        const partOfTree = {
          [[...p, k].join(SEPARATOR)]: isScalar,
        };
        return partOfTree;
      }
      return {};
    }
    if (Array.isArray(o)) {
      return ibb(k, k, o[1], p, pOriginals, false);
    }
    if (k === '__alias') {
      return Object.entries(o)
        .map(([alias, objectUnderAlias]) => {
          if (typeof objectUnderAlias !== 'object' || Array.isArray(objectUnderAlias)) {
            throw new Error(
              'Invalid alias it should be __alias:{ YOUR_ALIAS_NAME: { OPERATION_NAME: { ...selectors }}}',
            );
          }
          const operationName = Object.keys(objectUnderAlias)[0];
          const operation = objectUnderAlias[operationName];
          return ibb(alias, operationName, operation, p, pOriginals, false);
        })
        .reduce((a, b) => ({
          ...a,
          ...b,
        }));
    }
    const keyName = root ? ops[k] : k;
    return Object.entries(o)
      .filter(([k]) => k !== '__directives')
      .map(([k, v]) =>
        ibb(k, k, v, [...p, purifyGraphQLKey(keyName || k)], [...pOriginals, purifyGraphQLKey(originalKey)], false),
      )
      .reduce((a, b) => ({
        ...a,
        ...b,
      }));
  };
  return ibb;
};

export const purifyGraphQLKey = (k: string) => k.replace(/\([^)]*\)/g, '').replace(/^[^:]*\:/g, '');

const mapPart = (p: string) => {
  const [isArg, isField] = p.split('<>');
  if (isField) {
    return {
      v: isField,
      __type: 'field',
    } as const;
  }
  return {
    v: isArg,
    __type: 'arg',
  } as const;
};

type Part = ReturnType<typeof mapPart>;

export const ResolveFromPath = (props: AllTypesPropsType, returns: ReturnTypesType, ops: Operations) => {
  const ResolvePropsType = (mappedParts: Part[]) => {
    const oKey = ops[mappedParts[0].v];
    const propsP1 = oKey ? props[oKey] : props[mappedParts[0].v];
    if (propsP1 === 'enum' && mappedParts.length === 1) {
      return 'enum';
    }
    if (typeof propsP1 === 'string' && propsP1.startsWith('scalar.') && mappedParts.length === 1) {
      return propsP1;
    }
    if (typeof propsP1 === 'object') {
      if (mappedParts.length < 2) {
        return 'not';
      }
      const propsP2 = propsP1[mappedParts[1].v];
      if (typeof propsP2 === 'string') {
        return rpp(
          `${propsP2}${SEPARATOR}${mappedParts
            .slice(2)
            .map((mp) => mp.v)
            .join(SEPARATOR)}`,
        );
      }
      if (typeof propsP2 === 'object') {
        if (mappedParts.length < 3) {
          return 'not';
        }
        const propsP3 = propsP2[mappedParts[2].v];
        if (propsP3 && mappedParts[2].__type === 'arg') {
          return rpp(
            `${propsP3}${SEPARATOR}${mappedParts
              .slice(3)
              .map((mp) => mp.v)
              .join(SEPARATOR)}`,
          );
        }
      }
    }
  };
  const ResolveReturnType = (mappedParts: Part[]) => {
    if (mappedParts.length === 0) {
      return 'not';
    }
    const oKey = ops[mappedParts[0].v];
    const returnP1 = oKey ? returns[oKey] : returns[mappedParts[0].v];
    if (typeof returnP1 === 'object') {
      const returnP2 = returnP1[mappedParts[1].v];
      if (returnP2) {
        return rpp(
          `${returnP2}${SEPARATOR}${mappedParts
            .slice(2)
            .map((mp) => mp.v)
            .join(SEPARATOR)}`,
        );
      }
    }
  };
  const rpp = (path: string): 'enum' | 'not' | `scalar.${string}` => {
    const parts = path.split(SEPARATOR).filter((l) => l.length > 0);
    const mappedParts = parts.map(mapPart);
    const propsP1 = ResolvePropsType(mappedParts);
    if (propsP1) {
      return propsP1;
    }
    const returnP1 = ResolveReturnType(mappedParts);
    if (returnP1) {
      return returnP1;
    }
    return 'not';
  };
  return rpp;
};

export const InternalArgsBuilt = ({
  props,
  ops,
  returns,
  scalars,
  vars,
}: {
  props: AllTypesPropsType;
  returns: ReturnTypesType;
  ops: Operations;
  scalars?: ScalarDefinition;
  vars: Array<{ name: string; graphQLType: string }>;
}) => {
  const arb = (a: ZeusArgsType, p = '', root = true): string => {
    if (typeof a === 'string') {
      if (a.startsWith(START_VAR_NAME)) {
        const [varName, graphQLType] = a.replace(START_VAR_NAME, '$').split(GRAPHQL_TYPE_SEPARATOR);
        const v = vars.find((v) => v.name === varName);
        if (!v) {
          vars.push({
            name: varName,
            graphQLType,
          });
        } else {
          if (v.graphQLType !== graphQLType) {
            throw new Error(
              `Invalid variable exists with two different GraphQL Types, "${v.graphQLType}" and ${graphQLType}`,
            );
          }
        }
        return varName;
      }
    }
    const checkType = ResolveFromPath(props, returns, ops)(p);
    if (checkType.startsWith('scalar.')) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, ...splittedScalar] = checkType.split('.');
      const scalarKey = splittedScalar.join('.');
      return (scalars?.[scalarKey]?.encode?.(a) as string) || JSON.stringify(a);
    }
    if (Array.isArray(a)) {
      return `[${a.map((arr) => arb(arr, p, false)).join(', ')}]`;
    }
    if (typeof a === 'string') {
      if (checkType === 'enum') {
        return a;
      }
      return `${JSON.stringify(a)}`;
    }
    if (typeof a === 'object') {
      if (a === null) {
        return `null`;
      }
      const returnedObjectString = Object.entries(a)
        .filter(([, v]) => typeof v !== 'undefined')
        .map(([k, v]) => `${k}: ${arb(v, [p, k].join(SEPARATOR), false)}`)
        .join(',\n');
      if (!root) {
        return `{${returnedObjectString}}`;
      }
      return returnedObjectString;
    }
    return `${a}`;
  };
  return arb;
};

export const resolverFor = <X, T extends keyof ResolverInputTypes, Z extends keyof ResolverInputTypes[T]>(
  type: T,
  field: Z,
  fn: (
    args: Required<ResolverInputTypes[T]>[Z] extends [infer Input, any] ? Input : any,
    source: any,
  ) => Z extends keyof ModelTypes[T] ? ModelTypes[T][Z] | Promise<ModelTypes[T][Z]> | X : any,
) => fn as (args?: any, source?: any) => any;

export type UnwrapPromise<T> = T extends Promise<infer R> ? R : T;
export type ZeusState<T extends (...args: any[]) => Promise<any>> = NonNullable<UnwrapPromise<ReturnType<T>>>;
export type ZeusHook<
  T extends (...args: any[]) => Record<string, (...args: any[]) => Promise<any>>,
  N extends keyof ReturnType<T>,
> = ZeusState<ReturnType<T>[N]>;

export type WithTypeNameValue<T> = T & {
  __typename?: boolean;
  __directives?: string;
};
export type AliasType<T> = WithTypeNameValue<T> & {
  __alias?: Record<string, WithTypeNameValue<T>>;
};
type DeepAnify<T> = {
  [P in keyof T]?: any;
};
type IsPayLoad<T> = T extends [any, infer PayLoad] ? PayLoad : T;
export type ScalarDefinition = Record<string, ScalarResolver>;

type IsScalar<S, SCLR extends ScalarDefinition> = S extends 'scalar' & { name: infer T }
  ? T extends keyof SCLR
    ? SCLR[T]['decode'] extends (s: unknown) => unknown
      ? ReturnType<SCLR[T]['decode']>
      : unknown
    : unknown
  : S;
type IsArray<T, U, SCLR extends ScalarDefinition> = T extends Array<infer R>
  ? InputType<R, U, SCLR>[]
  : InputType<T, U, SCLR>;
type FlattenArray<T> = T extends Array<infer R> ? R : T;
type BaseZeusResolver = boolean | 1 | string | Variable<any, string>;

type IsInterfaced<SRC extends DeepAnify<DST>, DST, SCLR extends ScalarDefinition> = FlattenArray<SRC> extends
  | ZEUS_INTERFACES
  | ZEUS_UNIONS
  ? {
      [P in keyof SRC]: SRC[P] extends '__union' & infer R
        ? P extends keyof DST
          ? IsArray<R, '__typename' extends keyof DST ? DST[P] & { __typename: true } : DST[P], SCLR>
          : Record<string, unknown>
        : never;
    }[keyof DST] & {
      [P in keyof Omit<
        Pick<
          SRC,
          {
            [P in keyof DST]: SRC[P] extends '__union' & infer R ? never : P;
          }[keyof DST]
        >,
        '__typename'
      >]: IsPayLoad<DST[P]> extends BaseZeusResolver ? IsScalar<SRC[P], SCLR> : IsArray<SRC[P], DST[P], SCLR>;
    }
  : {
      [P in keyof Pick<SRC, keyof DST>]: IsPayLoad<DST[P]> extends BaseZeusResolver
        ? IsScalar<SRC[P], SCLR>
        : IsArray<SRC[P], DST[P], SCLR>;
    };

export type MapType<SRC, DST, SCLR extends ScalarDefinition> = SRC extends DeepAnify<DST>
  ? IsInterfaced<SRC, DST, SCLR>
  : never;
// eslint-disable-next-line @typescript-eslint/ban-types
export type InputType<SRC, DST, SCLR extends ScalarDefinition = {}> = IsPayLoad<DST> extends { __alias: infer R }
  ? {
      [P in keyof R]: MapType<SRC, R[P], SCLR>[keyof MapType<SRC, R[P], SCLR>];
    } & MapType<SRC, Omit<IsPayLoad<DST>, '__alias'>, SCLR>
  : MapType<SRC, IsPayLoad<DST>, SCLR>;
export type SubscriptionToGraphQL<Z, T, SCLR extends ScalarDefinition> = {
  ws: WebSocket;
  on: (fn: (args: InputType<T, Z, SCLR>) => void) => void;
  off: (fn: (e: { data?: InputType<T, Z, SCLR>; code?: number; reason?: string; message?: string }) => void) => void;
  error: (fn: (e: { data?: InputType<T, Z, SCLR>; errors?: string[] }) => void) => void;
  open: () => void;
};

// eslint-disable-next-line @typescript-eslint/ban-types
export type FromSelector<SELECTOR, NAME extends keyof GraphQLTypes, SCLR extends ScalarDefinition = {}> = InputType<
  GraphQLTypes[NAME],
  SELECTOR,
  SCLR
>;

export type ScalarResolver = {
  encode?: (s: unknown) => string;
  decode?: (s: unknown) => unknown;
};

export type SelectionFunction<V> = <T>(t: T | V) => T;

type BuiltInVariableTypes = {
  ['String']: string;
  ['Int']: number;
  ['Float']: number;
  ['ID']: unknown;
  ['Boolean']: boolean;
};
type AllVariableTypes = keyof BuiltInVariableTypes | keyof ZEUS_VARIABLES;
type VariableRequired<T extends string> = `${T}!` | T | `[${T}]` | `[${T}]!` | `[${T}!]` | `[${T}!]!`;
type VR<T extends string> = VariableRequired<VariableRequired<T>>;

export type GraphQLVariableType = VR<AllVariableTypes>;

type ExtractVariableTypeString<T extends string> = T extends VR<infer R1>
  ? R1 extends VR<infer R2>
    ? R2 extends VR<infer R3>
      ? R3 extends VR<infer R4>
        ? R4 extends VR<infer R5>
          ? R5
          : R4
        : R3
      : R2
    : R1
  : T;

type DecomposeType<T, Type> = T extends `[${infer R}]`
  ? Array<DecomposeType<R, Type>> | undefined
  : T extends `${infer R}!`
  ? NonNullable<DecomposeType<R, Type>>
  : Type | undefined;

type ExtractTypeFromGraphQLType<T extends string> = T extends keyof ZEUS_VARIABLES
  ? ZEUS_VARIABLES[T]
  : T extends keyof BuiltInVariableTypes
  ? BuiltInVariableTypes[T]
  : any;

export type GetVariableType<T extends string> = DecomposeType<
  T,
  ExtractTypeFromGraphQLType<ExtractVariableTypeString<T>>
>;

type UndefinedKeys<T> = {
  [K in keyof T]-?: T[K] extends NonNullable<T[K]> ? never : K;
}[keyof T];

type WithNullableKeys<T> = Pick<T, UndefinedKeys<T>>;
type WithNonNullableKeys<T> = Omit<T, UndefinedKeys<T>>;

type OptionalKeys<T> = {
  [P in keyof T]?: T[P];
};

export type WithOptionalNullables<T> = OptionalKeys<WithNullableKeys<T>> & WithNonNullableKeys<T>;

export type Variable<T extends GraphQLVariableType, Name extends string> = {
  ' __zeus_name': Name;
  ' __zeus_type': T;
};

export type ExtractVariables<Query> = Query extends Variable<infer VType, infer VName>
  ? { [key in VName]: GetVariableType<VType> }
  : Query extends [infer Inputs, infer Outputs]
  ? ExtractVariables<Inputs> & ExtractVariables<Outputs>
  : Query extends string | number | boolean
  ? // eslint-disable-next-line @typescript-eslint/ban-types
    {}
  : UnionToIntersection<{ [K in keyof Query]: WithOptionalNullables<ExtractVariables<Query[K]>> }[keyof Query]>;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

export const START_VAR_NAME = `$ZEUS_VAR`;
export const GRAPHQL_TYPE_SEPARATOR = `__$GRAPHQL__`;

export const $ = <Type extends GraphQLVariableType, Name extends string>(name: Name, graphqlType: Type) => {
  return (START_VAR_NAME + name + GRAPHQL_TYPE_SEPARATOR + graphqlType) as unknown as Variable<Type, Name>;
};
type ZEUS_INTERFACES = never
export type ScalarCoders = {
	bigint?: ScalarResolver;
	guildmanagerrole?: ScalarResolver;
	smallint?: ScalarResolver;
	teammemberrole?: ScalarResolver;
	time?: ScalarResolver;
	timestamptz?: ScalarResolver;
	visibility?: ScalarResolver;
}
type ZEUS_UNIONS = never

export type ValueTypes = {
    /** Boolean expression to compare columns of type "Boolean". All fields are combined with logical 'AND'. */
["Boolean_comparison_exp"]: {
	_eq?: boolean | undefined | null | Variable<any, string>,
	_gt?: boolean | undefined | null | Variable<any, string>,
	_gte?: boolean | undefined | null | Variable<any, string>,
	_in?: Array<boolean> | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	_lt?: boolean | undefined | null | Variable<any, string>,
	_lte?: boolean | undefined | null | Variable<any, string>,
	_neq?: boolean | undefined | null | Variable<any, string>,
	_nin?: Array<boolean> | undefined | null | Variable<any, string>
};
	/** Boolean expression to compare columns of type "Int". All fields are combined with logical 'AND'. */
["Int_comparison_exp"]: {
	_eq?: number | undefined | null | Variable<any, string>,
	_gt?: number | undefined | null | Variable<any, string>,
	_gte?: number | undefined | null | Variable<any, string>,
	_in?: Array<number> | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	_lt?: number | undefined | null | Variable<any, string>,
	_lte?: number | undefined | null | Variable<any, string>,
	_neq?: number | undefined | null | Variable<any, string>,
	_nin?: Array<number> | undefined | null | Variable<any, string>
};
	/** Boolean expression to compare columns of type "String". All fields are combined with logical 'AND'. */
["String_comparison_exp"]: {
	_eq?: string | undefined | null | Variable<any, string>,
	_gt?: string | undefined | null | Variable<any, string>,
	_gte?: string | undefined | null | Variable<any, string>,
	/** does the column match the given case-insensitive pattern */
	_ilike?: string | undefined | null | Variable<any, string>,
	_in?: Array<string> | undefined | null | Variable<any, string>,
	/** does the column match the given POSIX regular expression, case insensitive */
	_iregex?: string | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	/** does the column match the given pattern */
	_like?: string | undefined | null | Variable<any, string>,
	_lt?: string | undefined | null | Variable<any, string>,
	_lte?: string | undefined | null | Variable<any, string>,
	_neq?: string | undefined | null | Variable<any, string>,
	/** does the column NOT match the given case-insensitive pattern */
	_nilike?: string | undefined | null | Variable<any, string>,
	_nin?: Array<string> | undefined | null | Variable<any, string>,
	/** does the column NOT match the given POSIX regular expression, case insensitive */
	_niregex?: string | undefined | null | Variable<any, string>,
	/** does the column NOT match the given pattern */
	_nlike?: string | undefined | null | Variable<any, string>,
	/** does the column NOT match the given POSIX regular expression, case sensitive */
	_nregex?: string | undefined | null | Variable<any, string>,
	/** does the column NOT match the given SQL regular expression */
	_nsimilar?: string | undefined | null | Variable<any, string>,
	/** does the column match the given POSIX regular expression, case sensitive */
	_regex?: string | undefined | null | Variable<any, string>,
	/** does the column match the given SQL regular expression */
	_similar?: string | undefined | null | Variable<any, string>
};
	["bigint"]:unknown;
	/** Boolean expression to compare columns of type "bigint". All fields are combined with logical 'AND'. */
["bigint_comparison_exp"]: {
	_eq?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	_gt?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	_gte?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	_in?: Array<ValueTypes["bigint"]> | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	_lt?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	_lte?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	_neq?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	_nin?: Array<ValueTypes["bigint"]> | undefined | null | Variable<any, string>
};
	["guildmanagerrole"]:unknown;
	/** Boolean expression to compare columns of type "guildmanagerrole". All fields are combined with logical 'AND'. */
["guildmanagerrole_comparison_exp"]: {
	_eq?: ValueTypes["guildmanagerrole"] | undefined | null | Variable<any, string>,
	_gt?: ValueTypes["guildmanagerrole"] | undefined | null | Variable<any, string>,
	_gte?: ValueTypes["guildmanagerrole"] | undefined | null | Variable<any, string>,
	_in?: Array<ValueTypes["guildmanagerrole"]> | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	_lt?: ValueTypes["guildmanagerrole"] | undefined | null | Variable<any, string>,
	_lte?: ValueTypes["guildmanagerrole"] | undefined | null | Variable<any, string>,
	_neq?: ValueTypes["guildmanagerrole"] | undefined | null | Variable<any, string>,
	_nin?: Array<ValueTypes["guildmanagerrole"]> | undefined | null | Variable<any, string>
};
	/** columns and relationships of "guildmanagers" */
["guildmanagers"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	/** An object relationship */
	user?:ValueTypes["users"],
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "guildmanagers" */
["guildmanagers_aggregate"]: AliasType<{
	aggregate?:ValueTypes["guildmanagers_aggregate_fields"],
	nodes?:ValueTypes["guildmanagers"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "guildmanagers" */
["guildmanagers_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["guildmanagers_avg_fields"],
count?: [{	columns?: Array<ValueTypes["guildmanagers_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["guildmanagers_max_fields"],
	min?:ValueTypes["guildmanagers_min_fields"],
	stddev?:ValueTypes["guildmanagers_stddev_fields"],
	stddev_pop?:ValueTypes["guildmanagers_stddev_pop_fields"],
	stddev_samp?:ValueTypes["guildmanagers_stddev_samp_fields"],
	sum?:ValueTypes["guildmanagers_sum_fields"],
	var_pop?:ValueTypes["guildmanagers_var_pop_fields"],
	var_samp?:ValueTypes["guildmanagers_var_samp_fields"],
	variance?:ValueTypes["guildmanagers_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "guildmanagers" */
["guildmanagers_aggregate_order_by"]: {
	avg?: ValueTypes["guildmanagers_avg_order_by"] | undefined | null | Variable<any, string>,
	count?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	max?: ValueTypes["guildmanagers_max_order_by"] | undefined | null | Variable<any, string>,
	min?: ValueTypes["guildmanagers_min_order_by"] | undefined | null | Variable<any, string>,
	stddev?: ValueTypes["guildmanagers_stddev_order_by"] | undefined | null | Variable<any, string>,
	stddev_pop?: ValueTypes["guildmanagers_stddev_pop_order_by"] | undefined | null | Variable<any, string>,
	stddev_samp?: ValueTypes["guildmanagers_stddev_samp_order_by"] | undefined | null | Variable<any, string>,
	sum?: ValueTypes["guildmanagers_sum_order_by"] | undefined | null | Variable<any, string>,
	var_pop?: ValueTypes["guildmanagers_var_pop_order_by"] | undefined | null | Variable<any, string>,
	var_samp?: ValueTypes["guildmanagers_var_samp_order_by"] | undefined | null | Variable<any, string>,
	variance?: ValueTypes["guildmanagers_variance_order_by"] | undefined | null | Variable<any, string>
};
	/** input type for inserting array relation for remote table "guildmanagers" */
["guildmanagers_arr_rel_insert_input"]: {
	data: Array<ValueTypes["guildmanagers_insert_input"]> | Variable<any, string>,
	/** upsert condition */
	on_conflict?: ValueTypes["guildmanagers_on_conflict"] | undefined | null | Variable<any, string>
};
	/** aggregate avg on columns */
["guildmanagers_avg_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "guildmanagers" */
["guildmanagers_avg_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** Boolean expression to filter rows from the table "guildmanagers". All fields are combined with a logical 'AND'. */
["guildmanagers_bool_exp"]: {
	_and?: Array<ValueTypes["guildmanagers_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["guildmanagers_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["guildmanagers_bool_exp"]> | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["guildmanagerrole_comparison_exp"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** unique or primary key constraints on table "guildmanagers" */
["guildmanagers_constraint"]:guildmanagers_constraint;
	/** input type for incrementing numeric columns in table "guildmanagers" */
["guildmanagers_inc_input"]: {
	guild_id?: number | undefined | null | Variable<any, string>,
	manager_id?: number | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** input type for inserting data into table "guildmanagers" */
["guildmanagers_insert_input"]: {
	guild_id?: number | undefined | null | Variable<any, string>,
	manager_id?: number | undefined | null | Variable<any, string>,
	role?: ValueTypes["guildmanagerrole"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_obj_rel_insert_input"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["guildmanagers_max_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "guildmanagers" */
["guildmanagers_max_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate min on columns */
["guildmanagers_min_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "guildmanagers" */
["guildmanagers_min_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** response of any mutation on the table "guildmanagers" */
["guildmanagers_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ValueTypes["guildmanagers"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "guildmanagers" */
["guildmanagers_on_conflict"]: {
	constraint: ValueTypes["guildmanagers_constraint"] | Variable<any, string>,
	update_columns: Array<ValueTypes["guildmanagers_update_column"]> | Variable<any, string>,
	where?: ValueTypes["guildmanagers_bool_exp"] | undefined | null | Variable<any, string>
};
	/** Ordering options when selecting data from "guildmanagers". */
["guildmanagers_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** primary key columns input for table: guildmanagers */
["guildmanagers_pk_columns_input"]: {
	manager_id: number | Variable<any, string>
};
	/** select columns of table "guildmanagers" */
["guildmanagers_select_column"]:guildmanagers_select_column;
	/** input type for updating data in table "guildmanagers" */
["guildmanagers_set_input"]: {
	guild_id?: number | undefined | null | Variable<any, string>,
	manager_id?: number | undefined | null | Variable<any, string>,
	role?: ValueTypes["guildmanagerrole"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** aggregate stddev on columns */
["guildmanagers_stddev_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "guildmanagers" */
["guildmanagers_stddev_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_pop on columns */
["guildmanagers_stddev_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "guildmanagers" */
["guildmanagers_stddev_pop_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_samp on columns */
["guildmanagers_stddev_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "guildmanagers" */
["guildmanagers_stddev_samp_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate sum on columns */
["guildmanagers_sum_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "guildmanagers" */
["guildmanagers_sum_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** update columns of table "guildmanagers" */
["guildmanagers_update_column"]:guildmanagers_update_column;
	/** aggregate var_pop on columns */
["guildmanagers_var_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "guildmanagers" */
["guildmanagers_var_pop_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate var_samp on columns */
["guildmanagers_var_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "guildmanagers" */
["guildmanagers_var_samp_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate variance on columns */
["guildmanagers_variance_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "guildmanagers" */
["guildmanagers_variance_order_by"]: {
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** columns and relationships of "guildmembers" */
["guildmembers"]: AliasType<{
	avatar?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "guildmembers" */
["guildmembers_aggregate"]: AliasType<{
	aggregate?:ValueTypes["guildmembers_aggregate_fields"],
	nodes?:ValueTypes["guildmembers"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "guildmembers" */
["guildmembers_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["guildmembers_avg_fields"],
count?: [{	columns?: Array<ValueTypes["guildmembers_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["guildmembers_max_fields"],
	min?:ValueTypes["guildmembers_min_fields"],
	stddev?:ValueTypes["guildmembers_stddev_fields"],
	stddev_pop?:ValueTypes["guildmembers_stddev_pop_fields"],
	stddev_samp?:ValueTypes["guildmembers_stddev_samp_fields"],
	sum?:ValueTypes["guildmembers_sum_fields"],
	var_pop?:ValueTypes["guildmembers_var_pop_fields"],
	var_samp?:ValueTypes["guildmembers_var_samp_fields"],
	variance?:ValueTypes["guildmembers_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["guildmembers_avg_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "guildmembers". All fields are combined with a logical 'AND'. */
["guildmembers_bool_exp"]: {
	_and?: Array<ValueTypes["guildmembers_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["guildmembers_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["guildmembers_bool_exp"]> | undefined | null | Variable<any, string>,
	avatar?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	member_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	nickname?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** unique or primary key constraints on table "guildmembers" */
["guildmembers_constraint"]:guildmembers_constraint;
	/** input type for incrementing numeric columns in table "guildmembers" */
["guildmembers_inc_input"]: {
	guild_id?: number | undefined | null | Variable<any, string>,
	member_id?: number | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** input type for inserting data into table "guildmembers" */
["guildmembers_insert_input"]: {
	avatar?: string | undefined | null | Variable<any, string>,
	guild_id?: number | undefined | null | Variable<any, string>,
	member_id?: number | undefined | null | Variable<any, string>,
	nickname?: string | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["guildmembers_max_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["guildmembers_min_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** response of any mutation on the table "guildmembers" */
["guildmembers_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ValueTypes["guildmembers"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "guildmembers" */
["guildmembers_on_conflict"]: {
	constraint: ValueTypes["guildmembers_constraint"] | Variable<any, string>,
	update_columns: Array<ValueTypes["guildmembers_update_column"]> | Variable<any, string>,
	where?: ValueTypes["guildmembers_bool_exp"] | undefined | null | Variable<any, string>
};
	/** Ordering options when selecting data from "guildmembers". */
["guildmembers_order_by"]: {
	avatar?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	nickname?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** primary key columns input for table: guildmembers */
["guildmembers_pk_columns_input"]: {
	member_id: number | Variable<any, string>
};
	/** select columns of table "guildmembers" */
["guildmembers_select_column"]:guildmembers_select_column;
	/** input type for updating data in table "guildmembers" */
["guildmembers_set_input"]: {
	avatar?: string | undefined | null | Variable<any, string>,
	guild_id?: number | undefined | null | Variable<any, string>,
	member_id?: number | undefined | null | Variable<any, string>,
	nickname?: string | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** aggregate stddev on columns */
["guildmembers_stddev_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["guildmembers_stddev_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["guildmembers_stddev_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["guildmembers_sum_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** update columns of table "guildmembers" */
["guildmembers_update_column"]:guildmembers_update_column;
	/** aggregate var_pop on columns */
["guildmembers_var_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["guildmembers_var_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["guildmembers_variance_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** columns and relationships of "guilds" */
["guilds"]: AliasType<{
	alias?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
managers?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmanagers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmanagers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmanagers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmanagers"]],
managers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmanagers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmanagers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmanagers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmanagers_aggregate"]],
	moderator_role?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	preferred_locale?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
teams?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teams_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teams_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teams"]],
teams_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teams_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teams_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teams_aggregate"]],
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "guilds" */
["guilds_aggregate"]: AliasType<{
	aggregate?:ValueTypes["guilds_aggregate_fields"],
	nodes?:ValueTypes["guilds"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "guilds" */
["guilds_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["guilds_avg_fields"],
count?: [{	columns?: Array<ValueTypes["guilds_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["guilds_max_fields"],
	min?:ValueTypes["guilds_min_fields"],
	stddev?:ValueTypes["guilds_stddev_fields"],
	stddev_pop?:ValueTypes["guilds_stddev_pop_fields"],
	stddev_samp?:ValueTypes["guilds_stddev_samp_fields"],
	sum?:ValueTypes["guilds_sum_fields"],
	var_pop?:ValueTypes["guilds_var_pop_fields"],
	var_samp?:ValueTypes["guilds_var_samp_fields"],
	variance?:ValueTypes["guilds_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["guilds_avg_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "guilds". All fields are combined with a logical 'AND'. */
["guilds_bool_exp"]: {
	_and?: Array<ValueTypes["guilds_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["guilds_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["guilds_bool_exp"]> | undefined | null | Variable<any, string>,
	alias?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	deleted_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	description?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	icon?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	manager_role?: ValueTypes["bigint_comparison_exp"] | undefined | null | Variable<any, string>,
	managers?: ValueTypes["guildmanagers_bool_exp"] | undefined | null | Variable<any, string>,
	moderator_role?: ValueTypes["bigint_comparison_exp"] | undefined | null | Variable<any, string>,
	name?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	preferred_locale?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["bigint_comparison_exp"] | undefined | null | Variable<any, string>,
	teams?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** unique or primary key constraints on table "guilds" */
["guilds_constraint"]:guilds_constraint;
	/** input type for incrementing numeric columns in table "guilds" */
["guilds_inc_input"]: {
	guild_id?: number | undefined | null | Variable<any, string>,
	manager_role?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	moderator_role?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["bigint"] | undefined | null | Variable<any, string>
};
	/** input type for inserting data into table "guilds" */
["guilds_insert_input"]: {
	alias?: string | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	deleted_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	description?: string | undefined | null | Variable<any, string>,
	guild_id?: number | undefined | null | Variable<any, string>,
	icon?: string | undefined | null | Variable<any, string>,
	manager_role?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	managers?: ValueTypes["guildmanagers_arr_rel_insert_input"] | undefined | null | Variable<any, string>,
	moderator_role?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	name?: string | undefined | null | Variable<any, string>,
	preferred_locale?: string | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	teams?: ValueTypes["teams_arr_rel_insert_input"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["guilds_max_fields"]: AliasType<{
	alias?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	preferred_locale?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["guilds_min_fields"]: AliasType<{
	alias?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	preferred_locale?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** response of any mutation on the table "guilds" */
["guilds_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ValueTypes["guilds"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "guilds" */
["guilds_on_conflict"]: {
	constraint: ValueTypes["guilds_constraint"] | Variable<any, string>,
	update_columns: Array<ValueTypes["guilds_update_column"]> | Variable<any, string>,
	where?: ValueTypes["guilds_bool_exp"] | undefined | null | Variable<any, string>
};
	/** Ordering options when selecting data from "guilds". */
["guilds_order_by"]: {
	alias?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	deleted_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	description?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	icon?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	manager_role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	managers_aggregate?: ValueTypes["guildmanagers_aggregate_order_by"] | undefined | null | Variable<any, string>,
	moderator_role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	name?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	preferred_locale?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	teams_aggregate?: ValueTypes["teams_aggregate_order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** primary key columns input for table: guilds */
["guilds_pk_columns_input"]: {
	guild_id: number | Variable<any, string>
};
	/** select columns of table "guilds" */
["guilds_select_column"]:guilds_select_column;
	/** input type for updating data in table "guilds" */
["guilds_set_input"]: {
	alias?: string | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	deleted_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	description?: string | undefined | null | Variable<any, string>,
	guild_id?: number | undefined | null | Variable<any, string>,
	icon?: string | undefined | null | Variable<any, string>,
	manager_role?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	moderator_role?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	name?: string | undefined | null | Variable<any, string>,
	preferred_locale?: string | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev on columns */
["guilds_stddev_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["guilds_stddev_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["guilds_stddev_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["guilds_sum_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** update columns of table "guilds" */
["guilds_update_column"]:guilds_update_column;
	/** aggregate var_pop on columns */
["guilds_var_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["guilds_var_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["guilds_variance_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** columns and relationships of "guildwars2accounts" */
["guildwars2accounts"]: AliasType<{
	account_id?:boolean | `@${string}`,
	api_key?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	main?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	verified?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "guildwars2accounts" */
["guildwars2accounts_aggregate"]: AliasType<{
	aggregate?:ValueTypes["guildwars2accounts_aggregate_fields"],
	nodes?:ValueTypes["guildwars2accounts"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "guildwars2accounts" */
["guildwars2accounts_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["guildwars2accounts_avg_fields"],
count?: [{	columns?: Array<ValueTypes["guildwars2accounts_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["guildwars2accounts_max_fields"],
	min?:ValueTypes["guildwars2accounts_min_fields"],
	stddev?:ValueTypes["guildwars2accounts_stddev_fields"],
	stddev_pop?:ValueTypes["guildwars2accounts_stddev_pop_fields"],
	stddev_samp?:ValueTypes["guildwars2accounts_stddev_samp_fields"],
	sum?:ValueTypes["guildwars2accounts_sum_fields"],
	var_pop?:ValueTypes["guildwars2accounts_var_pop_fields"],
	var_samp?:ValueTypes["guildwars2accounts_var_samp_fields"],
	variance?:ValueTypes["guildwars2accounts_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "guildwars2accounts" */
["guildwars2accounts_aggregate_order_by"]: {
	avg?: ValueTypes["guildwars2accounts_avg_order_by"] | undefined | null | Variable<any, string>,
	count?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	max?: ValueTypes["guildwars2accounts_max_order_by"] | undefined | null | Variable<any, string>,
	min?: ValueTypes["guildwars2accounts_min_order_by"] | undefined | null | Variable<any, string>,
	stddev?: ValueTypes["guildwars2accounts_stddev_order_by"] | undefined | null | Variable<any, string>,
	stddev_pop?: ValueTypes["guildwars2accounts_stddev_pop_order_by"] | undefined | null | Variable<any, string>,
	stddev_samp?: ValueTypes["guildwars2accounts_stddev_samp_order_by"] | undefined | null | Variable<any, string>,
	sum?: ValueTypes["guildwars2accounts_sum_order_by"] | undefined | null | Variable<any, string>,
	var_pop?: ValueTypes["guildwars2accounts_var_pop_order_by"] | undefined | null | Variable<any, string>,
	var_samp?: ValueTypes["guildwars2accounts_var_samp_order_by"] | undefined | null | Variable<any, string>,
	variance?: ValueTypes["guildwars2accounts_variance_order_by"] | undefined | null | Variable<any, string>
};
	/** input type for inserting array relation for remote table "guildwars2accounts" */
["guildwars2accounts_arr_rel_insert_input"]: {
	data: Array<ValueTypes["guildwars2accounts_insert_input"]> | Variable<any, string>,
	/** upsert condition */
	on_conflict?: ValueTypes["guildwars2accounts_on_conflict"] | undefined | null | Variable<any, string>
};
	/** aggregate avg on columns */
["guildwars2accounts_avg_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "guildwars2accounts" */
["guildwars2accounts_avg_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** Boolean expression to filter rows from the table "guildwars2accounts". All fields are combined with a logical 'AND'. */
["guildwars2accounts_bool_exp"]: {
	_and?: Array<ValueTypes["guildwars2accounts_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["guildwars2accounts_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["guildwars2accounts_bool_exp"]> | undefined | null | Variable<any, string>,
	account_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	api_key?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	main?: ValueTypes["Boolean_comparison_exp"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	verified?: ValueTypes["Boolean_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** unique or primary key constraints on table "guildwars2accounts" */
["guildwars2accounts_constraint"]:guildwars2accounts_constraint;
	/** input type for incrementing numeric columns in table "guildwars2accounts" */
["guildwars2accounts_inc_input"]: {
	account_id?: number | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** input type for inserting data into table "guildwars2accounts" */
["guildwars2accounts_insert_input"]: {
	account_id?: number | undefined | null | Variable<any, string>,
	api_key?: string | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	main?: boolean | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>,
	verified?: boolean | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["guildwars2accounts_max_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	api_key?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "guildwars2accounts" */
["guildwars2accounts_max_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	api_key?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate min on columns */
["guildwars2accounts_min_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	api_key?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "guildwars2accounts" */
["guildwars2accounts_min_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	api_key?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** response of any mutation on the table "guildwars2accounts" */
["guildwars2accounts_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ValueTypes["guildwars2accounts"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "guildwars2accounts" */
["guildwars2accounts_on_conflict"]: {
	constraint: ValueTypes["guildwars2accounts_constraint"] | Variable<any, string>,
	update_columns: Array<ValueTypes["guildwars2accounts_update_column"]> | Variable<any, string>,
	where?: ValueTypes["guildwars2accounts_bool_exp"] | undefined | null | Variable<any, string>
};
	/** Ordering options when selecting data from "guildwars2accounts". */
["guildwars2accounts_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	api_key?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	main?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	verified?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** primary key columns input for table: guildwars2accounts */
["guildwars2accounts_pk_columns_input"]: {
	account_id: number | Variable<any, string>
};
	/** select columns of table "guildwars2accounts" */
["guildwars2accounts_select_column"]:guildwars2accounts_select_column;
	/** input type for updating data in table "guildwars2accounts" */
["guildwars2accounts_set_input"]: {
	account_id?: number | undefined | null | Variable<any, string>,
	api_key?: string | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	main?: boolean | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>,
	verified?: boolean | undefined | null | Variable<any, string>
};
	/** aggregate stddev on columns */
["guildwars2accounts_stddev_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_pop on columns */
["guildwars2accounts_stddev_pop_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_pop_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_samp on columns */
["guildwars2accounts_stddev_samp_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_samp_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate sum on columns */
["guildwars2accounts_sum_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "guildwars2accounts" */
["guildwars2accounts_sum_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** update columns of table "guildwars2accounts" */
["guildwars2accounts_update_column"]:guildwars2accounts_update_column;
	/** aggregate var_pop on columns */
["guildwars2accounts_var_pop_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "guildwars2accounts" */
["guildwars2accounts_var_pop_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate var_samp on columns */
["guildwars2accounts_var_samp_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "guildwars2accounts" */
["guildwars2accounts_var_samp_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate variance on columns */
["guildwars2accounts_variance_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "guildwars2accounts" */
["guildwars2accounts_variance_order_by"]: {
	account_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** mutation root */
["mutation_root"]: AliasType<{
delete_guildmanagers?: [{	/** filter the rows which have to be deleted */
	where: ValueTypes["guildmanagers_bool_exp"] | Variable<any, string>},ValueTypes["guildmanagers_mutation_response"]],
delete_guildmanagers_by_pk?: [{	manager_id: number | Variable<any, string>},ValueTypes["guildmanagers"]],
delete_guildmembers?: [{	/** filter the rows which have to be deleted */
	where: ValueTypes["guildmembers_bool_exp"] | Variable<any, string>},ValueTypes["guildmembers_mutation_response"]],
delete_guildmembers_by_pk?: [{	member_id: number | Variable<any, string>},ValueTypes["guildmembers"]],
delete_guilds?: [{	/** filter the rows which have to be deleted */
	where: ValueTypes["guilds_bool_exp"] | Variable<any, string>},ValueTypes["guilds_mutation_response"]],
delete_guilds_by_pk?: [{	guild_id: number | Variable<any, string>},ValueTypes["guilds"]],
delete_guildwars2accounts?: [{	/** filter the rows which have to be deleted */
	where: ValueTypes["guildwars2accounts_bool_exp"] | Variable<any, string>},ValueTypes["guildwars2accounts_mutation_response"]],
delete_guildwars2accounts_by_pk?: [{	account_id: number | Variable<any, string>},ValueTypes["guildwars2accounts"]],
delete_profiles?: [{	/** filter the rows which have to be deleted */
	where: ValueTypes["profiles_bool_exp"] | Variable<any, string>},ValueTypes["profiles_mutation_response"]],
delete_profiles_by_pk?: [{	profile_id: number | Variable<any, string>},ValueTypes["profiles"]],
delete_teammembers?: [{	/** filter the rows which have to be deleted */
	where: ValueTypes["teammembers_bool_exp"] | Variable<any, string>},ValueTypes["teammembers_mutation_response"]],
delete_teammembers_by_pk?: [{	member_id: number | Variable<any, string>},ValueTypes["teammembers"]],
delete_teams?: [{	/** filter the rows which have to be deleted */
	where: ValueTypes["teams_bool_exp"] | Variable<any, string>},ValueTypes["teams_mutation_response"]],
delete_teams_by_pk?: [{	team_id: number | Variable<any, string>},ValueTypes["teams"]],
delete_teamtimes?: [{	/** filter the rows which have to be deleted */
	where: ValueTypes["teamtimes_bool_exp"] | Variable<any, string>},ValueTypes["teamtimes_mutation_response"]],
delete_teamtimes_by_pk?: [{	time_id: number | Variable<any, string>},ValueTypes["teamtimes"]],
delete_users?: [{	/** filter the rows which have to be deleted */
	where: ValueTypes["users_bool_exp"] | Variable<any, string>},ValueTypes["users_mutation_response"]],
delete_users_by_pk?: [{	user_id: number | Variable<any, string>},ValueTypes["users"]],
insert_guildmanagers?: [{	/** the rows to be inserted */
	objects: Array<ValueTypes["guildmanagers_insert_input"]> | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["guildmanagers_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["guildmanagers_mutation_response"]],
insert_guildmanagers_one?: [{	/** the row to be inserted */
	object: ValueTypes["guildmanagers_insert_input"] | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["guildmanagers_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["guildmanagers"]],
insert_guildmembers?: [{	/** the rows to be inserted */
	objects: Array<ValueTypes["guildmembers_insert_input"]> | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["guildmembers_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["guildmembers_mutation_response"]],
insert_guildmembers_one?: [{	/** the row to be inserted */
	object: ValueTypes["guildmembers_insert_input"] | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["guildmembers_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["guildmembers"]],
insert_guilds?: [{	/** the rows to be inserted */
	objects: Array<ValueTypes["guilds_insert_input"]> | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["guilds_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["guilds_mutation_response"]],
insert_guilds_one?: [{	/** the row to be inserted */
	object: ValueTypes["guilds_insert_input"] | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["guilds_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["guilds"]],
insert_guildwars2accounts?: [{	/** the rows to be inserted */
	objects: Array<ValueTypes["guildwars2accounts_insert_input"]> | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["guildwars2accounts_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["guildwars2accounts_mutation_response"]],
insert_guildwars2accounts_one?: [{	/** the row to be inserted */
	object: ValueTypes["guildwars2accounts_insert_input"] | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["guildwars2accounts_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["guildwars2accounts"]],
insert_profiles?: [{	/** the rows to be inserted */
	objects: Array<ValueTypes["profiles_insert_input"]> | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["profiles_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["profiles_mutation_response"]],
insert_profiles_one?: [{	/** the row to be inserted */
	object: ValueTypes["profiles_insert_input"] | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["profiles_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["profiles"]],
insert_teammembers?: [{	/** the rows to be inserted */
	objects: Array<ValueTypes["teammembers_insert_input"]> | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["teammembers_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["teammembers_mutation_response"]],
insert_teammembers_one?: [{	/** the row to be inserted */
	object: ValueTypes["teammembers_insert_input"] | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["teammembers_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["teammembers"]],
insert_teams?: [{	/** the rows to be inserted */
	objects: Array<ValueTypes["teams_insert_input"]> | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["teams_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["teams_mutation_response"]],
insert_teams_one?: [{	/** the row to be inserted */
	object: ValueTypes["teams_insert_input"] | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["teams_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["teams"]],
insert_teamtimes?: [{	/** the rows to be inserted */
	objects: Array<ValueTypes["teamtimes_insert_input"]> | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["teamtimes_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["teamtimes_mutation_response"]],
insert_teamtimes_one?: [{	/** the row to be inserted */
	object: ValueTypes["teamtimes_insert_input"] | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["teamtimes_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["teamtimes"]],
insert_users?: [{	/** the rows to be inserted */
	objects: Array<ValueTypes["users_insert_input"]> | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["users_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["users_mutation_response"]],
insert_users_one?: [{	/** the row to be inserted */
	object: ValueTypes["users_insert_input"] | Variable<any, string>,	/** upsert condition */
	on_conflict?: ValueTypes["users_on_conflict"] | undefined | null | Variable<any, string>},ValueTypes["users"]],
update_guildmanagers?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["guildmanagers_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["guildmanagers_set_input"] | undefined | null | Variable<any, string>,	/** filter the rows which have to be updated */
	where: ValueTypes["guildmanagers_bool_exp"] | Variable<any, string>},ValueTypes["guildmanagers_mutation_response"]],
update_guildmanagers_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["guildmanagers_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["guildmanagers_set_input"] | undefined | null | Variable<any, string>,	pk_columns: ValueTypes["guildmanagers_pk_columns_input"] | Variable<any, string>},ValueTypes["guildmanagers"]],
update_guildmembers?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["guildmembers_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["guildmembers_set_input"] | undefined | null | Variable<any, string>,	/** filter the rows which have to be updated */
	where: ValueTypes["guildmembers_bool_exp"] | Variable<any, string>},ValueTypes["guildmembers_mutation_response"]],
update_guildmembers_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["guildmembers_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["guildmembers_set_input"] | undefined | null | Variable<any, string>,	pk_columns: ValueTypes["guildmembers_pk_columns_input"] | Variable<any, string>},ValueTypes["guildmembers"]],
update_guilds?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["guilds_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["guilds_set_input"] | undefined | null | Variable<any, string>,	/** filter the rows which have to be updated */
	where: ValueTypes["guilds_bool_exp"] | Variable<any, string>},ValueTypes["guilds_mutation_response"]],
update_guilds_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["guilds_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["guilds_set_input"] | undefined | null | Variable<any, string>,	pk_columns: ValueTypes["guilds_pk_columns_input"] | Variable<any, string>},ValueTypes["guilds"]],
update_guildwars2accounts?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["guildwars2accounts_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["guildwars2accounts_set_input"] | undefined | null | Variable<any, string>,	/** filter the rows which have to be updated */
	where: ValueTypes["guildwars2accounts_bool_exp"] | Variable<any, string>},ValueTypes["guildwars2accounts_mutation_response"]],
update_guildwars2accounts_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["guildwars2accounts_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["guildwars2accounts_set_input"] | undefined | null | Variable<any, string>,	pk_columns: ValueTypes["guildwars2accounts_pk_columns_input"] | Variable<any, string>},ValueTypes["guildwars2accounts"]],
update_profiles?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["profiles_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["profiles_set_input"] | undefined | null | Variable<any, string>,	/** filter the rows which have to be updated */
	where: ValueTypes["profiles_bool_exp"] | Variable<any, string>},ValueTypes["profiles_mutation_response"]],
update_profiles_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["profiles_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["profiles_set_input"] | undefined | null | Variable<any, string>,	pk_columns: ValueTypes["profiles_pk_columns_input"] | Variable<any, string>},ValueTypes["profiles"]],
update_teammembers?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["teammembers_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["teammembers_set_input"] | undefined | null | Variable<any, string>,	/** filter the rows which have to be updated */
	where: ValueTypes["teammembers_bool_exp"] | Variable<any, string>},ValueTypes["teammembers_mutation_response"]],
update_teammembers_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["teammembers_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["teammembers_set_input"] | undefined | null | Variable<any, string>,	pk_columns: ValueTypes["teammembers_pk_columns_input"] | Variable<any, string>},ValueTypes["teammembers"]],
update_teams?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["teams_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["teams_set_input"] | undefined | null | Variable<any, string>,	/** filter the rows which have to be updated */
	where: ValueTypes["teams_bool_exp"] | Variable<any, string>},ValueTypes["teams_mutation_response"]],
update_teams_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["teams_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["teams_set_input"] | undefined | null | Variable<any, string>,	pk_columns: ValueTypes["teams_pk_columns_input"] | Variable<any, string>},ValueTypes["teams"]],
update_teamtimes?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["teamtimes_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["teamtimes_set_input"] | undefined | null | Variable<any, string>,	/** filter the rows which have to be updated */
	where: ValueTypes["teamtimes_bool_exp"] | Variable<any, string>},ValueTypes["teamtimes_mutation_response"]],
update_teamtimes_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["teamtimes_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["teamtimes_set_input"] | undefined | null | Variable<any, string>,	pk_columns: ValueTypes["teamtimes_pk_columns_input"] | Variable<any, string>},ValueTypes["teamtimes"]],
update_users?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["users_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["users_set_input"] | undefined | null | Variable<any, string>,	/** filter the rows which have to be updated */
	where: ValueTypes["users_bool_exp"] | Variable<any, string>},ValueTypes["users_mutation_response"]],
update_users_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ValueTypes["users_inc_input"] | undefined | null | Variable<any, string>,	/** sets the columns of the filtered rows to the given values */
	_set?: ValueTypes["users_set_input"] | undefined | null | Variable<any, string>,	pk_columns: ValueTypes["users_pk_columns_input"] | Variable<any, string>},ValueTypes["users"]],
		__typename?: boolean | `@${string}`
}>;
	/** column ordering options */
["order_by"]:order_by;
	/** columns and relationships of "profiles" */
["profiles"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	/** An object relationship */
	user?:ValueTypes["users"],
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "profiles" */
["profiles_aggregate"]: AliasType<{
	aggregate?:ValueTypes["profiles_aggregate_fields"],
	nodes?:ValueTypes["profiles"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "profiles" */
["profiles_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["profiles_avg_fields"],
count?: [{	columns?: Array<ValueTypes["profiles_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["profiles_max_fields"],
	min?:ValueTypes["profiles_min_fields"],
	stddev?:ValueTypes["profiles_stddev_fields"],
	stddev_pop?:ValueTypes["profiles_stddev_pop_fields"],
	stddev_samp?:ValueTypes["profiles_stddev_samp_fields"],
	sum?:ValueTypes["profiles_sum_fields"],
	var_pop?:ValueTypes["profiles_var_pop_fields"],
	var_samp?:ValueTypes["profiles_var_samp_fields"],
	variance?:ValueTypes["profiles_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["profiles_avg_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "profiles". All fields are combined with a logical 'AND'. */
["profiles_bool_exp"]: {
	_and?: Array<ValueTypes["profiles_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["profiles_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["profiles_bool_exp"]> | undefined | null | Variable<any, string>,
	avatar?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	profile_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** unique or primary key constraints on table "profiles" */
["profiles_constraint"]:profiles_constraint;
	/** input type for incrementing numeric columns in table "profiles" */
["profiles_inc_input"]: {
	profile_id?: number | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** input type for inserting data into table "profiles" */
["profiles_insert_input"]: {
	avatar?: string | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	profile_id?: number | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_obj_rel_insert_input"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["profiles_max_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["profiles_min_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** response of any mutation on the table "profiles" */
["profiles_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ValueTypes["profiles"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "profiles" */
["profiles_on_conflict"]: {
	constraint: ValueTypes["profiles_constraint"] | Variable<any, string>,
	update_columns: Array<ValueTypes["profiles_update_column"]> | Variable<any, string>,
	where?: ValueTypes["profiles_bool_exp"] | undefined | null | Variable<any, string>
};
	/** Ordering options when selecting data from "profiles". */
["profiles_order_by"]: {
	avatar?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	profile_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** primary key columns input for table: profiles */
["profiles_pk_columns_input"]: {
	profile_id: number | Variable<any, string>
};
	/** select columns of table "profiles" */
["profiles_select_column"]:profiles_select_column;
	/** input type for updating data in table "profiles" */
["profiles_set_input"]: {
	avatar?: string | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	profile_id?: number | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** aggregate stddev on columns */
["profiles_stddev_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["profiles_stddev_pop_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["profiles_stddev_samp_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["profiles_sum_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** update columns of table "profiles" */
["profiles_update_column"]:profiles_update_column;
	/** aggregate var_pop on columns */
["profiles_var_pop_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["profiles_var_samp_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["profiles_variance_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	["query_root"]: AliasType<{
guildmanagers?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmanagers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmanagers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmanagers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmanagers"]],
guildmanagers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmanagers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmanagers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmanagers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmanagers_aggregate"]],
guildmanagers_by_pk?: [{	manager_id: number | Variable<any, string>},ValueTypes["guildmanagers"]],
guildmembers?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmembers"]],
guildmembers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmembers_aggregate"]],
guildmembers_by_pk?: [{	member_id: number | Variable<any, string>},ValueTypes["guildmembers"]],
guilds?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guilds_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guilds_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guilds_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guilds"]],
guilds_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guilds_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guilds_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guilds_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guilds_aggregate"]],
guilds_by_pk?: [{	guild_id: number | Variable<any, string>},ValueTypes["guilds"]],
guildwars2accounts?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildwars2accounts_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildwars2accounts_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildwars2accounts_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildwars2accounts"]],
guildwars2accounts_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildwars2accounts_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildwars2accounts_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildwars2accounts_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildwars2accounts_aggregate"]],
guildwars2accounts_by_pk?: [{	account_id: number | Variable<any, string>},ValueTypes["guildwars2accounts"]],
profiles?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["profiles_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["profiles_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["profiles_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["profiles"]],
profiles_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["profiles_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["profiles_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["profiles_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["profiles_aggregate"]],
profiles_by_pk?: [{	profile_id: number | Variable<any, string>},ValueTypes["profiles"]],
teammembers?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teammembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teammembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teammembers"]],
teammembers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teammembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teammembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teammembers_aggregate"]],
teammembers_by_pk?: [{	member_id: number | Variable<any, string>},ValueTypes["teammembers"]],
teams?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teams_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teams_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teams"]],
teams_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teams_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teams_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teams_aggregate"]],
teams_by_pk?: [{	team_id: number | Variable<any, string>},ValueTypes["teams"]],
teamtimes?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teamtimes_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teamtimes_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teamtimes_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teamtimes"]],
teamtimes_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teamtimes_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teamtimes_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teamtimes_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teamtimes_aggregate"]],
teamtimes_by_pk?: [{	time_id: number | Variable<any, string>},ValueTypes["teamtimes"]],
usermemberships?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["usermemberships_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["usermemberships_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["usermemberships_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["usermemberships"]],
usermemberships_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["usermemberships_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["usermemberships_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["usermemberships_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["usermemberships_aggregate"]],
userprofiles?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["userprofiles_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["userprofiles_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["userprofiles_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["userprofiles"]],
userprofiles_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["userprofiles_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["userprofiles_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["userprofiles_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["userprofiles_aggregate"]],
users?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["users_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["users_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["users"]],
users_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["users_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["users_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["users_aggregate"]],
users_by_pk?: [{	user_id: number | Variable<any, string>},ValueTypes["users"]],
		__typename?: boolean | `@${string}`
}>;
	["smallint"]:unknown;
	/** Boolean expression to compare columns of type "smallint". All fields are combined with logical 'AND'. */
["smallint_comparison_exp"]: {
	_eq?: ValueTypes["smallint"] | undefined | null | Variable<any, string>,
	_gt?: ValueTypes["smallint"] | undefined | null | Variable<any, string>,
	_gte?: ValueTypes["smallint"] | undefined | null | Variable<any, string>,
	_in?: Array<ValueTypes["smallint"]> | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	_lt?: ValueTypes["smallint"] | undefined | null | Variable<any, string>,
	_lte?: ValueTypes["smallint"] | undefined | null | Variable<any, string>,
	_neq?: ValueTypes["smallint"] | undefined | null | Variable<any, string>,
	_nin?: Array<ValueTypes["smallint"]> | undefined | null | Variable<any, string>
};
	["subscription_root"]: AliasType<{
guildmanagers?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmanagers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmanagers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmanagers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmanagers"]],
guildmanagers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmanagers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmanagers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmanagers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmanagers_aggregate"]],
guildmanagers_by_pk?: [{	manager_id: number | Variable<any, string>},ValueTypes["guildmanagers"]],
guildmembers?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmembers"]],
guildmembers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildmembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildmembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildmembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildmembers_aggregate"]],
guildmembers_by_pk?: [{	member_id: number | Variable<any, string>},ValueTypes["guildmembers"]],
guilds?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guilds_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guilds_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guilds_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guilds"]],
guilds_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guilds_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guilds_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guilds_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guilds_aggregate"]],
guilds_by_pk?: [{	guild_id: number | Variable<any, string>},ValueTypes["guilds"]],
guildwars2accounts?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildwars2accounts_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildwars2accounts_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildwars2accounts_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildwars2accounts"]],
guildwars2accounts_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildwars2accounts_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildwars2accounts_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildwars2accounts_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildwars2accounts_aggregate"]],
guildwars2accounts_by_pk?: [{	account_id: number | Variable<any, string>},ValueTypes["guildwars2accounts"]],
profiles?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["profiles_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["profiles_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["profiles_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["profiles"]],
profiles_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["profiles_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["profiles_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["profiles_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["profiles_aggregate"]],
profiles_by_pk?: [{	profile_id: number | Variable<any, string>},ValueTypes["profiles"]],
teammembers?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teammembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teammembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teammembers"]],
teammembers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teammembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teammembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teammembers_aggregate"]],
teammembers_by_pk?: [{	member_id: number | Variable<any, string>},ValueTypes["teammembers"]],
teams?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teams_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teams_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teams"]],
teams_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teams_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teams_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teams_aggregate"]],
teams_by_pk?: [{	team_id: number | Variable<any, string>},ValueTypes["teams"]],
teamtimes?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teamtimes_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teamtimes_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teamtimes_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teamtimes"]],
teamtimes_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teamtimes_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teamtimes_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teamtimes_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teamtimes_aggregate"]],
teamtimes_by_pk?: [{	time_id: number | Variable<any, string>},ValueTypes["teamtimes"]],
usermemberships?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["usermemberships_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["usermemberships_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["usermemberships_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["usermemberships"]],
usermemberships_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["usermemberships_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["usermemberships_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["usermemberships_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["usermemberships_aggregate"]],
userprofiles?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["userprofiles_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["userprofiles_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["userprofiles_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["userprofiles"]],
userprofiles_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["userprofiles_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["userprofiles_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["userprofiles_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["userprofiles_aggregate"]],
users?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["users_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["users_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["users"]],
users_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["users_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["users_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["users_aggregate"]],
users_by_pk?: [{	user_id: number | Variable<any, string>},ValueTypes["users"]],
		__typename?: boolean | `@${string}`
}>;
	["teammemberrole"]:unknown;
	/** Boolean expression to compare columns of type "teammemberrole". All fields are combined with logical 'AND'. */
["teammemberrole_comparison_exp"]: {
	_eq?: ValueTypes["teammemberrole"] | undefined | null | Variable<any, string>,
	_gt?: ValueTypes["teammemberrole"] | undefined | null | Variable<any, string>,
	_gte?: ValueTypes["teammemberrole"] | undefined | null | Variable<any, string>,
	_in?: Array<ValueTypes["teammemberrole"]> | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	_lt?: ValueTypes["teammemberrole"] | undefined | null | Variable<any, string>,
	_lte?: ValueTypes["teammemberrole"] | undefined | null | Variable<any, string>,
	_neq?: ValueTypes["teammemberrole"] | undefined | null | Variable<any, string>,
	_nin?: Array<ValueTypes["teammemberrole"]> | undefined | null | Variable<any, string>
};
	/** columns and relationships of "teammembers" */
["teammembers"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	/** An object relationship */
	team?:ValueTypes["teams"],
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	/** An object relationship */
	user?:ValueTypes["users"],
	user_id?:boolean | `@${string}`,
	visibility?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "teammembers" */
["teammembers_aggregate"]: AliasType<{
	aggregate?:ValueTypes["teammembers_aggregate_fields"],
	nodes?:ValueTypes["teammembers"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "teammembers" */
["teammembers_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["teammembers_avg_fields"],
count?: [{	columns?: Array<ValueTypes["teammembers_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["teammembers_max_fields"],
	min?:ValueTypes["teammembers_min_fields"],
	stddev?:ValueTypes["teammembers_stddev_fields"],
	stddev_pop?:ValueTypes["teammembers_stddev_pop_fields"],
	stddev_samp?:ValueTypes["teammembers_stddev_samp_fields"],
	sum?:ValueTypes["teammembers_sum_fields"],
	var_pop?:ValueTypes["teammembers_var_pop_fields"],
	var_samp?:ValueTypes["teammembers_var_samp_fields"],
	variance?:ValueTypes["teammembers_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "teammembers" */
["teammembers_aggregate_order_by"]: {
	avg?: ValueTypes["teammembers_avg_order_by"] | undefined | null | Variable<any, string>,
	count?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	max?: ValueTypes["teammembers_max_order_by"] | undefined | null | Variable<any, string>,
	min?: ValueTypes["teammembers_min_order_by"] | undefined | null | Variable<any, string>,
	stddev?: ValueTypes["teammembers_stddev_order_by"] | undefined | null | Variable<any, string>,
	stddev_pop?: ValueTypes["teammembers_stddev_pop_order_by"] | undefined | null | Variable<any, string>,
	stddev_samp?: ValueTypes["teammembers_stddev_samp_order_by"] | undefined | null | Variable<any, string>,
	sum?: ValueTypes["teammembers_sum_order_by"] | undefined | null | Variable<any, string>,
	var_pop?: ValueTypes["teammembers_var_pop_order_by"] | undefined | null | Variable<any, string>,
	var_samp?: ValueTypes["teammembers_var_samp_order_by"] | undefined | null | Variable<any, string>,
	variance?: ValueTypes["teammembers_variance_order_by"] | undefined | null | Variable<any, string>
};
	/** input type for inserting array relation for remote table "teammembers" */
["teammembers_arr_rel_insert_input"]: {
	data: Array<ValueTypes["teammembers_insert_input"]> | Variable<any, string>,
	/** upsert condition */
	on_conflict?: ValueTypes["teammembers_on_conflict"] | undefined | null | Variable<any, string>
};
	/** aggregate avg on columns */
["teammembers_avg_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "teammembers" */
["teammembers_avg_order_by"]: {
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** Boolean expression to filter rows from the table "teammembers". All fields are combined with a logical 'AND'. */
["teammembers_bool_exp"]: {
	_and?: Array<ValueTypes["teammembers_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["teammembers_bool_exp"]> | undefined | null | Variable<any, string>,
	avatar?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	member_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	nickname?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["teammemberrole_comparison_exp"] | undefined | null | Variable<any, string>,
	team?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	visibility?: ValueTypes["visibility_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** unique or primary key constraints on table "teammembers" */
["teammembers_constraint"]:teammembers_constraint;
	/** input type for incrementing numeric columns in table "teammembers" */
["teammembers_inc_input"]: {
	member_id?: number | undefined | null | Variable<any, string>,
	team_id?: number | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** input type for inserting data into table "teammembers" */
["teammembers_insert_input"]: {
	avatar?: string | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	member_id?: number | undefined | null | Variable<any, string>,
	nickname?: string | undefined | null | Variable<any, string>,
	role?: ValueTypes["teammemberrole"] | undefined | null | Variable<any, string>,
	team?: ValueTypes["teams_obj_rel_insert_input"] | undefined | null | Variable<any, string>,
	team_id?: number | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_obj_rel_insert_input"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>,
	visibility?: ValueTypes["visibility"] | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["teammembers_max_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	visibility?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "teammembers" */
["teammembers_max_order_by"]: {
	avatar?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	nickname?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	visibility?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate min on columns */
["teammembers_min_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	visibility?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "teammembers" */
["teammembers_min_order_by"]: {
	avatar?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	nickname?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	visibility?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** response of any mutation on the table "teammembers" */
["teammembers_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ValueTypes["teammembers"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "teammembers" */
["teammembers_on_conflict"]: {
	constraint: ValueTypes["teammembers_constraint"] | Variable<any, string>,
	update_columns: Array<ValueTypes["teammembers_update_column"]> | Variable<any, string>,
	where?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>
};
	/** Ordering options when selecting data from "teammembers". */
["teammembers_order_by"]: {
	avatar?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	nickname?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team?: ValueTypes["teams_order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	visibility?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** primary key columns input for table: teammembers */
["teammembers_pk_columns_input"]: {
	member_id: number | Variable<any, string>
};
	/** select columns of table "teammembers" */
["teammembers_select_column"]:teammembers_select_column;
	/** input type for updating data in table "teammembers" */
["teammembers_set_input"]: {
	avatar?: string | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	member_id?: number | undefined | null | Variable<any, string>,
	nickname?: string | undefined | null | Variable<any, string>,
	role?: ValueTypes["teammemberrole"] | undefined | null | Variable<any, string>,
	team_id?: number | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>,
	visibility?: ValueTypes["visibility"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev on columns */
["teammembers_stddev_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "teammembers" */
["teammembers_stddev_order_by"]: {
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_pop on columns */
["teammembers_stddev_pop_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "teammembers" */
["teammembers_stddev_pop_order_by"]: {
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_samp on columns */
["teammembers_stddev_samp_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "teammembers" */
["teammembers_stddev_samp_order_by"]: {
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate sum on columns */
["teammembers_sum_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "teammembers" */
["teammembers_sum_order_by"]: {
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** update columns of table "teammembers" */
["teammembers_update_column"]:teammembers_update_column;
	/** aggregate var_pop on columns */
["teammembers_var_pop_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "teammembers" */
["teammembers_var_pop_order_by"]: {
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate var_samp on columns */
["teammembers_var_samp_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "teammembers" */
["teammembers_var_samp_order_by"]: {
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate variance on columns */
["teammembers_variance_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "teammembers" */
["teammembers_variance_order_by"]: {
	member_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** columns and relationships of "teams" */
["teams"]: AliasType<{
	alias?:boolean | `@${string}`,
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
members?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teammembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teammembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teammembers"]],
members_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teammembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teammembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teammembers_aggregate"]],
	name?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
times?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teamtimes_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teamtimes_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teamtimes_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teamtimes"]],
times_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teamtimes_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teamtimes_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teamtimes_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teamtimes_aggregate"]],
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "teams" */
["teams_aggregate"]: AliasType<{
	aggregate?:ValueTypes["teams_aggregate_fields"],
	nodes?:ValueTypes["teams"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "teams" */
["teams_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["teams_avg_fields"],
count?: [{	columns?: Array<ValueTypes["teams_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["teams_max_fields"],
	min?:ValueTypes["teams_min_fields"],
	stddev?:ValueTypes["teams_stddev_fields"],
	stddev_pop?:ValueTypes["teams_stddev_pop_fields"],
	stddev_samp?:ValueTypes["teams_stddev_samp_fields"],
	sum?:ValueTypes["teams_sum_fields"],
	var_pop?:ValueTypes["teams_var_pop_fields"],
	var_samp?:ValueTypes["teams_var_samp_fields"],
	variance?:ValueTypes["teams_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "teams" */
["teams_aggregate_order_by"]: {
	avg?: ValueTypes["teams_avg_order_by"] | undefined | null | Variable<any, string>,
	count?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	max?: ValueTypes["teams_max_order_by"] | undefined | null | Variable<any, string>,
	min?: ValueTypes["teams_min_order_by"] | undefined | null | Variable<any, string>,
	stddev?: ValueTypes["teams_stddev_order_by"] | undefined | null | Variable<any, string>,
	stddev_pop?: ValueTypes["teams_stddev_pop_order_by"] | undefined | null | Variable<any, string>,
	stddev_samp?: ValueTypes["teams_stddev_samp_order_by"] | undefined | null | Variable<any, string>,
	sum?: ValueTypes["teams_sum_order_by"] | undefined | null | Variable<any, string>,
	var_pop?: ValueTypes["teams_var_pop_order_by"] | undefined | null | Variable<any, string>,
	var_samp?: ValueTypes["teams_var_samp_order_by"] | undefined | null | Variable<any, string>,
	variance?: ValueTypes["teams_variance_order_by"] | undefined | null | Variable<any, string>
};
	/** input type for inserting array relation for remote table "teams" */
["teams_arr_rel_insert_input"]: {
	data: Array<ValueTypes["teams_insert_input"]> | Variable<any, string>,
	/** upsert condition */
	on_conflict?: ValueTypes["teams_on_conflict"] | undefined | null | Variable<any, string>
};
	/** aggregate avg on columns */
["teams_avg_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "teams" */
["teams_avg_order_by"]: {
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** Boolean expression to filter rows from the table "teams". All fields are combined with a logical 'AND'. */
["teams_bool_exp"]: {
	_and?: Array<ValueTypes["teams_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["teams_bool_exp"]> | undefined | null | Variable<any, string>,
	alias?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	channel?: ValueTypes["bigint_comparison_exp"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	description?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	icon?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	members?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>,
	name?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["bigint_comparison_exp"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	times?: ValueTypes["teamtimes_bool_exp"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** unique or primary key constraints on table "teams" */
["teams_constraint"]:teams_constraint;
	/** input type for incrementing numeric columns in table "teams" */
["teams_inc_input"]: {
	channel?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	color?: number | undefined | null | Variable<any, string>,
	guild_id?: number | undefined | null | Variable<any, string>,
	role?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	team_id?: number | undefined | null | Variable<any, string>
};
	/** input type for inserting data into table "teams" */
["teams_insert_input"]: {
	alias?: string | undefined | null | Variable<any, string>,
	channel?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	color?: number | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	description?: string | undefined | null | Variable<any, string>,
	guild_id?: number | undefined | null | Variable<any, string>,
	icon?: string | undefined | null | Variable<any, string>,
	members?: ValueTypes["teammembers_arr_rel_insert_input"] | undefined | null | Variable<any, string>,
	name?: string | undefined | null | Variable<any, string>,
	role?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	team_id?: number | undefined | null | Variable<any, string>,
	times?: ValueTypes["teamtimes_arr_rel_insert_input"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["teams_max_fields"]: AliasType<{
	alias?:boolean | `@${string}`,
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "teams" */
["teams_max_order_by"]: {
	alias?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	description?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	icon?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	name?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate min on columns */
["teams_min_fields"]: AliasType<{
	alias?:boolean | `@${string}`,
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "teams" */
["teams_min_order_by"]: {
	alias?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	description?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	icon?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	name?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** response of any mutation on the table "teams" */
["teams_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ValueTypes["teams"],
		__typename?: boolean | `@${string}`
}>;
	/** input type for inserting object relation for remote table "teams" */
["teams_obj_rel_insert_input"]: {
	data: ValueTypes["teams_insert_input"] | Variable<any, string>,
	/** upsert condition */
	on_conflict?: ValueTypes["teams_on_conflict"] | undefined | null | Variable<any, string>
};
	/** on_conflict condition type for table "teams" */
["teams_on_conflict"]: {
	constraint: ValueTypes["teams_constraint"] | Variable<any, string>,
	update_columns: Array<ValueTypes["teams_update_column"]> | Variable<any, string>,
	where?: ValueTypes["teams_bool_exp"] | undefined | null | Variable<any, string>
};
	/** Ordering options when selecting data from "teams". */
["teams_order_by"]: {
	alias?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	description?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	icon?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	members_aggregate?: ValueTypes["teammembers_aggregate_order_by"] | undefined | null | Variable<any, string>,
	name?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	times_aggregate?: ValueTypes["teamtimes_aggregate_order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** primary key columns input for table: teams */
["teams_pk_columns_input"]: {
	team_id: number | Variable<any, string>
};
	/** select columns of table "teams" */
["teams_select_column"]:teams_select_column;
	/** input type for updating data in table "teams" */
["teams_set_input"]: {
	alias?: string | undefined | null | Variable<any, string>,
	channel?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	color?: number | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	description?: string | undefined | null | Variable<any, string>,
	guild_id?: number | undefined | null | Variable<any, string>,
	icon?: string | undefined | null | Variable<any, string>,
	name?: string | undefined | null | Variable<any, string>,
	role?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	team_id?: number | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev on columns */
["teams_stddev_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "teams" */
["teams_stddev_order_by"]: {
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_pop on columns */
["teams_stddev_pop_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "teams" */
["teams_stddev_pop_order_by"]: {
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_samp on columns */
["teams_stddev_samp_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "teams" */
["teams_stddev_samp_order_by"]: {
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate sum on columns */
["teams_sum_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "teams" */
["teams_sum_order_by"]: {
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** update columns of table "teams" */
["teams_update_column"]:teams_update_column;
	/** aggregate var_pop on columns */
["teams_var_pop_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "teams" */
["teams_var_pop_order_by"]: {
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate var_samp on columns */
["teams_var_samp_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "teams" */
["teams_var_samp_order_by"]: {
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate variance on columns */
["teams_variance_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "teams" */
["teams_variance_order_by"]: {
	channel?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	color?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** columns and relationships of "teamtimes" */
["teamtimes"]: AliasType<{
	duration?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	time?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "teamtimes" */
["teamtimes_aggregate"]: AliasType<{
	aggregate?:ValueTypes["teamtimes_aggregate_fields"],
	nodes?:ValueTypes["teamtimes"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "teamtimes" */
["teamtimes_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["teamtimes_avg_fields"],
count?: [{	columns?: Array<ValueTypes["teamtimes_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["teamtimes_max_fields"],
	min?:ValueTypes["teamtimes_min_fields"],
	stddev?:ValueTypes["teamtimes_stddev_fields"],
	stddev_pop?:ValueTypes["teamtimes_stddev_pop_fields"],
	stddev_samp?:ValueTypes["teamtimes_stddev_samp_fields"],
	sum?:ValueTypes["teamtimes_sum_fields"],
	var_pop?:ValueTypes["teamtimes_var_pop_fields"],
	var_samp?:ValueTypes["teamtimes_var_samp_fields"],
	variance?:ValueTypes["teamtimes_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "teamtimes" */
["teamtimes_aggregate_order_by"]: {
	avg?: ValueTypes["teamtimes_avg_order_by"] | undefined | null | Variable<any, string>,
	count?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	max?: ValueTypes["teamtimes_max_order_by"] | undefined | null | Variable<any, string>,
	min?: ValueTypes["teamtimes_min_order_by"] | undefined | null | Variable<any, string>,
	stddev?: ValueTypes["teamtimes_stddev_order_by"] | undefined | null | Variable<any, string>,
	stddev_pop?: ValueTypes["teamtimes_stddev_pop_order_by"] | undefined | null | Variable<any, string>,
	stddev_samp?: ValueTypes["teamtimes_stddev_samp_order_by"] | undefined | null | Variable<any, string>,
	sum?: ValueTypes["teamtimes_sum_order_by"] | undefined | null | Variable<any, string>,
	var_pop?: ValueTypes["teamtimes_var_pop_order_by"] | undefined | null | Variable<any, string>,
	var_samp?: ValueTypes["teamtimes_var_samp_order_by"] | undefined | null | Variable<any, string>,
	variance?: ValueTypes["teamtimes_variance_order_by"] | undefined | null | Variable<any, string>
};
	/** input type for inserting array relation for remote table "teamtimes" */
["teamtimes_arr_rel_insert_input"]: {
	data: Array<ValueTypes["teamtimes_insert_input"]> | Variable<any, string>,
	/** upsert condition */
	on_conflict?: ValueTypes["teamtimes_on_conflict"] | undefined | null | Variable<any, string>
};
	/** aggregate avg on columns */
["teamtimes_avg_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "teamtimes" */
["teamtimes_avg_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** Boolean expression to filter rows from the table "teamtimes". All fields are combined with a logical 'AND'. */
["teamtimes_bool_exp"]: {
	_and?: Array<ValueTypes["teamtimes_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["teamtimes_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["teamtimes_bool_exp"]> | undefined | null | Variable<any, string>,
	duration?: ValueTypes["time_comparison_exp"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	time?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** unique or primary key constraints on table "teamtimes" */
["teamtimes_constraint"]:teamtimes_constraint;
	/** input type for incrementing numeric columns in table "teamtimes" */
["teamtimes_inc_input"]: {
	team_id?: number | undefined | null | Variable<any, string>,
	time_id?: number | undefined | null | Variable<any, string>
};
	/** input type for inserting data into table "teamtimes" */
["teamtimes_insert_input"]: {
	duration?: ValueTypes["time"] | undefined | null | Variable<any, string>,
	team_id?: number | undefined | null | Variable<any, string>,
	time?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	time_id?: number | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["teamtimes_max_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "teamtimes" */
["teamtimes_max_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate min on columns */
["teamtimes_min_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "teamtimes" */
["teamtimes_min_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** response of any mutation on the table "teamtimes" */
["teamtimes_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ValueTypes["teamtimes"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "teamtimes" */
["teamtimes_on_conflict"]: {
	constraint: ValueTypes["teamtimes_constraint"] | Variable<any, string>,
	update_columns: Array<ValueTypes["teamtimes_update_column"]> | Variable<any, string>,
	where?: ValueTypes["teamtimes_bool_exp"] | undefined | null | Variable<any, string>
};
	/** Ordering options when selecting data from "teamtimes". */
["teamtimes_order_by"]: {
	duration?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** primary key columns input for table: teamtimes */
["teamtimes_pk_columns_input"]: {
	time_id: number | Variable<any, string>
};
	/** select columns of table "teamtimes" */
["teamtimes_select_column"]:teamtimes_select_column;
	/** input type for updating data in table "teamtimes" */
["teamtimes_set_input"]: {
	duration?: ValueTypes["time"] | undefined | null | Variable<any, string>,
	team_id?: number | undefined | null | Variable<any, string>,
	time?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	time_id?: number | undefined | null | Variable<any, string>
};
	/** aggregate stddev on columns */
["teamtimes_stddev_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "teamtimes" */
["teamtimes_stddev_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_pop on columns */
["teamtimes_stddev_pop_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "teamtimes" */
["teamtimes_stddev_pop_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate stddev_samp on columns */
["teamtimes_stddev_samp_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "teamtimes" */
["teamtimes_stddev_samp_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate sum on columns */
["teamtimes_sum_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "teamtimes" */
["teamtimes_sum_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** update columns of table "teamtimes" */
["teamtimes_update_column"]:teamtimes_update_column;
	/** aggregate var_pop on columns */
["teamtimes_var_pop_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "teamtimes" */
["teamtimes_var_pop_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate var_samp on columns */
["teamtimes_var_samp_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "teamtimes" */
["teamtimes_var_samp_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** aggregate variance on columns */
["teamtimes_variance_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "teamtimes" */
["teamtimes_variance_order_by"]: {
	team_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	time_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	["time"]:unknown;
	/** Boolean expression to compare columns of type "time". All fields are combined with logical 'AND'. */
["time_comparison_exp"]: {
	_eq?: ValueTypes["time"] | undefined | null | Variable<any, string>,
	_gt?: ValueTypes["time"] | undefined | null | Variable<any, string>,
	_gte?: ValueTypes["time"] | undefined | null | Variable<any, string>,
	_in?: Array<ValueTypes["time"]> | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	_lt?: ValueTypes["time"] | undefined | null | Variable<any, string>,
	_lte?: ValueTypes["time"] | undefined | null | Variable<any, string>,
	_neq?: ValueTypes["time"] | undefined | null | Variable<any, string>,
	_nin?: Array<ValueTypes["time"]> | undefined | null | Variable<any, string>
};
	["timestamptz"]:unknown;
	/** Boolean expression to compare columns of type "timestamptz". All fields are combined with logical 'AND'. */
["timestamptz_comparison_exp"]: {
	_eq?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	_gt?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	_gte?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	_in?: Array<ValueTypes["timestamptz"]> | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	_lt?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	_lte?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	_neq?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	_nin?: Array<ValueTypes["timestamptz"]> | undefined | null | Variable<any, string>
};
	/** columns and relationships of "usermemberships" */
["usermemberships"]: AliasType<{
	/** An object relationship */
	guild?:ValueTypes["guilds"],
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	/** An object relationship */
	user?:ValueTypes["users"],
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "usermemberships" */
["usermemberships_aggregate"]: AliasType<{
	aggregate?:ValueTypes["usermemberships_aggregate_fields"],
	nodes?:ValueTypes["usermemberships"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "usermemberships" */
["usermemberships_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["usermemberships_avg_fields"],
count?: [{	columns?: Array<ValueTypes["usermemberships_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["usermemberships_max_fields"],
	min?:ValueTypes["usermemberships_min_fields"],
	stddev?:ValueTypes["usermemberships_stddev_fields"],
	stddev_pop?:ValueTypes["usermemberships_stddev_pop_fields"],
	stddev_samp?:ValueTypes["usermemberships_stddev_samp_fields"],
	sum?:ValueTypes["usermemberships_sum_fields"],
	var_pop?:ValueTypes["usermemberships_var_pop_fields"],
	var_samp?:ValueTypes["usermemberships_var_samp_fields"],
	variance?:ValueTypes["usermemberships_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["usermemberships_avg_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "usermemberships". All fields are combined with a logical 'AND'. */
["usermemberships_bool_exp"]: {
	_and?: Array<ValueTypes["usermemberships_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["usermemberships_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["usermemberships_bool_exp"]> | undefined | null | Variable<any, string>,
	guild?: ValueTypes["guilds_bool_exp"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["usermemberships_max_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["usermemberships_min_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Ordering options when selecting data from "usermemberships". */
["usermemberships_order_by"]: {
	guild?: ValueTypes["guilds_order_by"] | undefined | null | Variable<any, string>,
	guild_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	role?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** select columns of table "usermemberships" */
["usermemberships_select_column"]:usermemberships_select_column;
	/** aggregate stddev on columns */
["usermemberships_stddev_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["usermemberships_stddev_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["usermemberships_stddev_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["usermemberships_sum_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_pop on columns */
["usermemberships_var_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["usermemberships_var_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["usermemberships_variance_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** columns and relationships of "userprofiles" */
["userprofiles"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	/** An object relationship */
	profile?:ValueTypes["profiles"],
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	/** An object relationship */
	user?:ValueTypes["users"],
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "userprofiles" */
["userprofiles_aggregate"]: AliasType<{
	aggregate?:ValueTypes["userprofiles_aggregate_fields"],
	nodes?:ValueTypes["userprofiles"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "userprofiles" */
["userprofiles_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["userprofiles_avg_fields"],
count?: [{	columns?: Array<ValueTypes["userprofiles_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["userprofiles_max_fields"],
	min?:ValueTypes["userprofiles_min_fields"],
	stddev?:ValueTypes["userprofiles_stddev_fields"],
	stddev_pop?:ValueTypes["userprofiles_stddev_pop_fields"],
	stddev_samp?:ValueTypes["userprofiles_stddev_samp_fields"],
	sum?:ValueTypes["userprofiles_sum_fields"],
	var_pop?:ValueTypes["userprofiles_var_pop_fields"],
	var_samp?:ValueTypes["userprofiles_var_samp_fields"],
	variance?:ValueTypes["userprofiles_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["userprofiles_avg_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "userprofiles". All fields are combined with a logical 'AND'. */
["userprofiles_bool_exp"]: {
	_and?: Array<ValueTypes["userprofiles_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["userprofiles_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["userprofiles_bool_exp"]> | undefined | null | Variable<any, string>,
	avatar?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	discriminator?: ValueTypes["smallint_comparison_exp"] | undefined | null | Variable<any, string>,
	profile?: ValueTypes["profiles_bool_exp"] | undefined | null | Variable<any, string>,
	profile_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["bigint_comparison_exp"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	username?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["userprofiles_max_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["userprofiles_min_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Ordering options when selecting data from "userprofiles". */
["userprofiles_order_by"]: {
	avatar?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	discriminator?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	profile?: ValueTypes["profiles_order_by"] | undefined | null | Variable<any, string>,
	profile_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user?: ValueTypes["users_order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	username?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** select columns of table "userprofiles" */
["userprofiles_select_column"]:userprofiles_select_column;
	/** aggregate stddev on columns */
["userprofiles_stddev_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["userprofiles_stddev_pop_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["userprofiles_stddev_samp_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["userprofiles_sum_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_pop on columns */
["userprofiles_var_pop_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["userprofiles_var_samp_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["userprofiles_variance_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** columns and relationships of "users" */
["users"]: AliasType<{
accounts?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildwars2accounts_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildwars2accounts_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildwars2accounts_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildwars2accounts"]],
accounts_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["guildwars2accounts_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["guildwars2accounts_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["guildwars2accounts_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["guildwars2accounts_aggregate"]],
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
teammemberships?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teammembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teammembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teammembers"]],
teammemberships_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ValueTypes["teammembers_select_column"]> | undefined | null | Variable<any, string>,	/** limit the number of rows returned */
	limit?: number | undefined | null | Variable<any, string>,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null | Variable<any, string>,	/** sort the rows by one or more columns */
	order_by?: Array<ValueTypes["teammembers_order_by"]> | undefined | null | Variable<any, string>,	/** filter the rows returned */
	where?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>},ValueTypes["teammembers_aggregate"]],
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "users" */
["users_aggregate"]: AliasType<{
	aggregate?:ValueTypes["users_aggregate_fields"],
	nodes?:ValueTypes["users"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "users" */
["users_aggregate_fields"]: AliasType<{
	avg?:ValueTypes["users_avg_fields"],
count?: [{	columns?: Array<ValueTypes["users_select_column"]> | undefined | null | Variable<any, string>,	distinct?: boolean | undefined | null | Variable<any, string>},boolean | `@${string}`],
	max?:ValueTypes["users_max_fields"],
	min?:ValueTypes["users_min_fields"],
	stddev?:ValueTypes["users_stddev_fields"],
	stddev_pop?:ValueTypes["users_stddev_pop_fields"],
	stddev_samp?:ValueTypes["users_stddev_samp_fields"],
	sum?:ValueTypes["users_sum_fields"],
	var_pop?:ValueTypes["users_var_pop_fields"],
	var_samp?:ValueTypes["users_var_samp_fields"],
	variance?:ValueTypes["users_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["users_avg_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "users". All fields are combined with a logical 'AND'. */
["users_bool_exp"]: {
	_and?: Array<ValueTypes["users_bool_exp"]> | undefined | null | Variable<any, string>,
	_not?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>,
	_or?: Array<ValueTypes["users_bool_exp"]> | undefined | null | Variable<any, string>,
	accounts?: ValueTypes["guildwars2accounts_bool_exp"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	deleted_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	discriminator?: ValueTypes["smallint_comparison_exp"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["bigint_comparison_exp"] | undefined | null | Variable<any, string>,
	teammemberships?: ValueTypes["teammembers_bool_exp"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz_comparison_exp"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["Int_comparison_exp"] | undefined | null | Variable<any, string>,
	username?: ValueTypes["String_comparison_exp"] | undefined | null | Variable<any, string>
};
	/** unique or primary key constraints on table "users" */
["users_constraint"]:users_constraint;
	/** input type for incrementing numeric columns in table "users" */
["users_inc_input"]: {
	discriminator?: ValueTypes["smallint"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>
};
	/** input type for inserting data into table "users" */
["users_insert_input"]: {
	accounts?: ValueTypes["guildwars2accounts_arr_rel_insert_input"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	deleted_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	discriminator?: ValueTypes["smallint"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	teammemberships?: ValueTypes["teammembers_arr_rel_insert_input"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>,
	username?: string | undefined | null | Variable<any, string>
};
	/** aggregate max on columns */
["users_max_fields"]: AliasType<{
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["users_min_fields"]: AliasType<{
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** response of any mutation on the table "users" */
["users_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ValueTypes["users"],
		__typename?: boolean | `@${string}`
}>;
	/** input type for inserting object relation for remote table "users" */
["users_obj_rel_insert_input"]: {
	data: ValueTypes["users_insert_input"] | Variable<any, string>,
	/** upsert condition */
	on_conflict?: ValueTypes["users_on_conflict"] | undefined | null | Variable<any, string>
};
	/** on_conflict condition type for table "users" */
["users_on_conflict"]: {
	constraint: ValueTypes["users_constraint"] | Variable<any, string>,
	update_columns: Array<ValueTypes["users_update_column"]> | Variable<any, string>,
	where?: ValueTypes["users_bool_exp"] | undefined | null | Variable<any, string>
};
	/** Ordering options when selecting data from "users". */
["users_order_by"]: {
	accounts_aggregate?: ValueTypes["guildwars2accounts_aggregate_order_by"] | undefined | null | Variable<any, string>,
	created_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	deleted_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	discriminator?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	teammemberships_aggregate?: ValueTypes["teammembers_aggregate_order_by"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	user_id?: ValueTypes["order_by"] | undefined | null | Variable<any, string>,
	username?: ValueTypes["order_by"] | undefined | null | Variable<any, string>
};
	/** primary key columns input for table: users */
["users_pk_columns_input"]: {
	user_id: number | Variable<any, string>
};
	/** select columns of table "users" */
["users_select_column"]:users_select_column;
	/** input type for updating data in table "users" */
["users_set_input"]: {
	created_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	deleted_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	discriminator?: ValueTypes["smallint"] | undefined | null | Variable<any, string>,
	snowflake?: ValueTypes["bigint"] | undefined | null | Variable<any, string>,
	updated_at?: ValueTypes["timestamptz"] | undefined | null | Variable<any, string>,
	user_id?: number | undefined | null | Variable<any, string>,
	username?: string | undefined | null | Variable<any, string>
};
	/** aggregate stddev on columns */
["users_stddev_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["users_stddev_pop_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["users_stddev_samp_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["users_sum_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** update columns of table "users" */
["users_update_column"]:users_update_column;
	/** aggregate var_pop on columns */
["users_var_pop_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["users_var_samp_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["users_variance_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	["visibility"]:unknown;
	/** Boolean expression to compare columns of type "visibility". All fields are combined with logical 'AND'. */
["visibility_comparison_exp"]: {
	_eq?: ValueTypes["visibility"] | undefined | null | Variable<any, string>,
	_gt?: ValueTypes["visibility"] | undefined | null | Variable<any, string>,
	_gte?: ValueTypes["visibility"] | undefined | null | Variable<any, string>,
	_in?: Array<ValueTypes["visibility"]> | undefined | null | Variable<any, string>,
	_is_null?: boolean | undefined | null | Variable<any, string>,
	_lt?: ValueTypes["visibility"] | undefined | null | Variable<any, string>,
	_lte?: ValueTypes["visibility"] | undefined | null | Variable<any, string>,
	_neq?: ValueTypes["visibility"] | undefined | null | Variable<any, string>,
	_nin?: Array<ValueTypes["visibility"]> | undefined | null | Variable<any, string>
}
  }

export type ResolverInputTypes = {
    /** Boolean expression to compare columns of type "Boolean". All fields are combined with logical 'AND'. */
["Boolean_comparison_exp"]: {
	_eq?: boolean | undefined | null,
	_gt?: boolean | undefined | null,
	_gte?: boolean | undefined | null,
	_in?: Array<boolean> | undefined | null,
	_is_null?: boolean | undefined | null,
	_lt?: boolean | undefined | null,
	_lte?: boolean | undefined | null,
	_neq?: boolean | undefined | null,
	_nin?: Array<boolean> | undefined | null
};
	/** Boolean expression to compare columns of type "Int". All fields are combined with logical 'AND'. */
["Int_comparison_exp"]: {
	_eq?: number | undefined | null,
	_gt?: number | undefined | null,
	_gte?: number | undefined | null,
	_in?: Array<number> | undefined | null,
	_is_null?: boolean | undefined | null,
	_lt?: number | undefined | null,
	_lte?: number | undefined | null,
	_neq?: number | undefined | null,
	_nin?: Array<number> | undefined | null
};
	/** Boolean expression to compare columns of type "String". All fields are combined with logical 'AND'. */
["String_comparison_exp"]: {
	_eq?: string | undefined | null,
	_gt?: string | undefined | null,
	_gte?: string | undefined | null,
	/** does the column match the given case-insensitive pattern */
	_ilike?: string | undefined | null,
	_in?: Array<string> | undefined | null,
	/** does the column match the given POSIX regular expression, case insensitive */
	_iregex?: string | undefined | null,
	_is_null?: boolean | undefined | null,
	/** does the column match the given pattern */
	_like?: string | undefined | null,
	_lt?: string | undefined | null,
	_lte?: string | undefined | null,
	_neq?: string | undefined | null,
	/** does the column NOT match the given case-insensitive pattern */
	_nilike?: string | undefined | null,
	_nin?: Array<string> | undefined | null,
	/** does the column NOT match the given POSIX regular expression, case insensitive */
	_niregex?: string | undefined | null,
	/** does the column NOT match the given pattern */
	_nlike?: string | undefined | null,
	/** does the column NOT match the given POSIX regular expression, case sensitive */
	_nregex?: string | undefined | null,
	/** does the column NOT match the given SQL regular expression */
	_nsimilar?: string | undefined | null,
	/** does the column match the given POSIX regular expression, case sensitive */
	_regex?: string | undefined | null,
	/** does the column match the given SQL regular expression */
	_similar?: string | undefined | null
};
	["bigint"]:unknown;
	/** Boolean expression to compare columns of type "bigint". All fields are combined with logical 'AND'. */
["bigint_comparison_exp"]: {
	_eq?: ResolverInputTypes["bigint"] | undefined | null,
	_gt?: ResolverInputTypes["bigint"] | undefined | null,
	_gte?: ResolverInputTypes["bigint"] | undefined | null,
	_in?: Array<ResolverInputTypes["bigint"]> | undefined | null,
	_is_null?: boolean | undefined | null,
	_lt?: ResolverInputTypes["bigint"] | undefined | null,
	_lte?: ResolverInputTypes["bigint"] | undefined | null,
	_neq?: ResolverInputTypes["bigint"] | undefined | null,
	_nin?: Array<ResolverInputTypes["bigint"]> | undefined | null
};
	["guildmanagerrole"]:unknown;
	/** Boolean expression to compare columns of type "guildmanagerrole". All fields are combined with logical 'AND'. */
["guildmanagerrole_comparison_exp"]: {
	_eq?: ResolverInputTypes["guildmanagerrole"] | undefined | null,
	_gt?: ResolverInputTypes["guildmanagerrole"] | undefined | null,
	_gte?: ResolverInputTypes["guildmanagerrole"] | undefined | null,
	_in?: Array<ResolverInputTypes["guildmanagerrole"]> | undefined | null,
	_is_null?: boolean | undefined | null,
	_lt?: ResolverInputTypes["guildmanagerrole"] | undefined | null,
	_lte?: ResolverInputTypes["guildmanagerrole"] | undefined | null,
	_neq?: ResolverInputTypes["guildmanagerrole"] | undefined | null,
	_nin?: Array<ResolverInputTypes["guildmanagerrole"]> | undefined | null
};
	/** columns and relationships of "guildmanagers" */
["guildmanagers"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	/** An object relationship */
	user?:ResolverInputTypes["users"],
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "guildmanagers" */
["guildmanagers_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["guildmanagers_aggregate_fields"],
	nodes?:ResolverInputTypes["guildmanagers"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "guildmanagers" */
["guildmanagers_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["guildmanagers_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["guildmanagers_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["guildmanagers_max_fields"],
	min?:ResolverInputTypes["guildmanagers_min_fields"],
	stddev?:ResolverInputTypes["guildmanagers_stddev_fields"],
	stddev_pop?:ResolverInputTypes["guildmanagers_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["guildmanagers_stddev_samp_fields"],
	sum?:ResolverInputTypes["guildmanagers_sum_fields"],
	var_pop?:ResolverInputTypes["guildmanagers_var_pop_fields"],
	var_samp?:ResolverInputTypes["guildmanagers_var_samp_fields"],
	variance?:ResolverInputTypes["guildmanagers_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "guildmanagers" */
["guildmanagers_aggregate_order_by"]: {
	avg?: ResolverInputTypes["guildmanagers_avg_order_by"] | undefined | null,
	count?: ResolverInputTypes["order_by"] | undefined | null,
	max?: ResolverInputTypes["guildmanagers_max_order_by"] | undefined | null,
	min?: ResolverInputTypes["guildmanagers_min_order_by"] | undefined | null,
	stddev?: ResolverInputTypes["guildmanagers_stddev_order_by"] | undefined | null,
	stddev_pop?: ResolverInputTypes["guildmanagers_stddev_pop_order_by"] | undefined | null,
	stddev_samp?: ResolverInputTypes["guildmanagers_stddev_samp_order_by"] | undefined | null,
	sum?: ResolverInputTypes["guildmanagers_sum_order_by"] | undefined | null,
	var_pop?: ResolverInputTypes["guildmanagers_var_pop_order_by"] | undefined | null,
	var_samp?: ResolverInputTypes["guildmanagers_var_samp_order_by"] | undefined | null,
	variance?: ResolverInputTypes["guildmanagers_variance_order_by"] | undefined | null
};
	/** input type for inserting array relation for remote table "guildmanagers" */
["guildmanagers_arr_rel_insert_input"]: {
	data: Array<ResolverInputTypes["guildmanagers_insert_input"]>,
	/** upsert condition */
	on_conflict?: ResolverInputTypes["guildmanagers_on_conflict"] | undefined | null
};
	/** aggregate avg on columns */
["guildmanagers_avg_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "guildmanagers" */
["guildmanagers_avg_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** Boolean expression to filter rows from the table "guildmanagers". All fields are combined with a logical 'AND'. */
["guildmanagers_bool_exp"]: {
	_and?: Array<ResolverInputTypes["guildmanagers_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["guildmanagers_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["guildmanagers_bool_exp"]> | undefined | null,
	guild_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	manager_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	role?: ResolverInputTypes["guildmanagerrole_comparison_exp"] | undefined | null,
	user?: ResolverInputTypes["users_bool_exp"] | undefined | null,
	user_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null
};
	/** unique or primary key constraints on table "guildmanagers" */
["guildmanagers_constraint"]:guildmanagers_constraint;
	/** input type for incrementing numeric columns in table "guildmanagers" */
["guildmanagers_inc_input"]: {
	guild_id?: number | undefined | null,
	manager_id?: number | undefined | null,
	user_id?: number | undefined | null
};
	/** input type for inserting data into table "guildmanagers" */
["guildmanagers_insert_input"]: {
	guild_id?: number | undefined | null,
	manager_id?: number | undefined | null,
	role?: ResolverInputTypes["guildmanagerrole"] | undefined | null,
	user?: ResolverInputTypes["users_obj_rel_insert_input"] | undefined | null,
	user_id?: number | undefined | null
};
	/** aggregate max on columns */
["guildmanagers_max_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "guildmanagers" */
["guildmanagers_max_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate min on columns */
["guildmanagers_min_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "guildmanagers" */
["guildmanagers_min_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** response of any mutation on the table "guildmanagers" */
["guildmanagers_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ResolverInputTypes["guildmanagers"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "guildmanagers" */
["guildmanagers_on_conflict"]: {
	constraint: ResolverInputTypes["guildmanagers_constraint"],
	update_columns: Array<ResolverInputTypes["guildmanagers_update_column"]>,
	where?: ResolverInputTypes["guildmanagers_bool_exp"] | undefined | null
};
	/** Ordering options when selecting data from "guildmanagers". */
["guildmanagers_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	user?: ResolverInputTypes["users_order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** primary key columns input for table: guildmanagers */
["guildmanagers_pk_columns_input"]: {
	manager_id: number
};
	/** select columns of table "guildmanagers" */
["guildmanagers_select_column"]:guildmanagers_select_column;
	/** input type for updating data in table "guildmanagers" */
["guildmanagers_set_input"]: {
	guild_id?: number | undefined | null,
	manager_id?: number | undefined | null,
	role?: ResolverInputTypes["guildmanagerrole"] | undefined | null,
	user_id?: number | undefined | null
};
	/** aggregate stddev on columns */
["guildmanagers_stddev_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "guildmanagers" */
["guildmanagers_stddev_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_pop on columns */
["guildmanagers_stddev_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "guildmanagers" */
["guildmanagers_stddev_pop_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_samp on columns */
["guildmanagers_stddev_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "guildmanagers" */
["guildmanagers_stddev_samp_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate sum on columns */
["guildmanagers_sum_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "guildmanagers" */
["guildmanagers_sum_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** update columns of table "guildmanagers" */
["guildmanagers_update_column"]:guildmanagers_update_column;
	/** aggregate var_pop on columns */
["guildmanagers_var_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "guildmanagers" */
["guildmanagers_var_pop_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate var_samp on columns */
["guildmanagers_var_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "guildmanagers" */
["guildmanagers_var_samp_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate variance on columns */
["guildmanagers_variance_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "guildmanagers" */
["guildmanagers_variance_order_by"]: {
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	manager_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** columns and relationships of "guildmembers" */
["guildmembers"]: AliasType<{
	avatar?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "guildmembers" */
["guildmembers_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["guildmembers_aggregate_fields"],
	nodes?:ResolverInputTypes["guildmembers"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "guildmembers" */
["guildmembers_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["guildmembers_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["guildmembers_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["guildmembers_max_fields"],
	min?:ResolverInputTypes["guildmembers_min_fields"],
	stddev?:ResolverInputTypes["guildmembers_stddev_fields"],
	stddev_pop?:ResolverInputTypes["guildmembers_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["guildmembers_stddev_samp_fields"],
	sum?:ResolverInputTypes["guildmembers_sum_fields"],
	var_pop?:ResolverInputTypes["guildmembers_var_pop_fields"],
	var_samp?:ResolverInputTypes["guildmembers_var_samp_fields"],
	variance?:ResolverInputTypes["guildmembers_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["guildmembers_avg_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "guildmembers". All fields are combined with a logical 'AND'. */
["guildmembers_bool_exp"]: {
	_and?: Array<ResolverInputTypes["guildmembers_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["guildmembers_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["guildmembers_bool_exp"]> | undefined | null,
	avatar?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	guild_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	member_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	nickname?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	user_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null
};
	/** unique or primary key constraints on table "guildmembers" */
["guildmembers_constraint"]:guildmembers_constraint;
	/** input type for incrementing numeric columns in table "guildmembers" */
["guildmembers_inc_input"]: {
	guild_id?: number | undefined | null,
	member_id?: number | undefined | null,
	user_id?: number | undefined | null
};
	/** input type for inserting data into table "guildmembers" */
["guildmembers_insert_input"]: {
	avatar?: string | undefined | null,
	guild_id?: number | undefined | null,
	member_id?: number | undefined | null,
	nickname?: string | undefined | null,
	user_id?: number | undefined | null
};
	/** aggregate max on columns */
["guildmembers_max_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["guildmembers_min_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** response of any mutation on the table "guildmembers" */
["guildmembers_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ResolverInputTypes["guildmembers"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "guildmembers" */
["guildmembers_on_conflict"]: {
	constraint: ResolverInputTypes["guildmembers_constraint"],
	update_columns: Array<ResolverInputTypes["guildmembers_update_column"]>,
	where?: ResolverInputTypes["guildmembers_bool_exp"] | undefined | null
};
	/** Ordering options when selecting data from "guildmembers". */
["guildmembers_order_by"]: {
	avatar?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	nickname?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** primary key columns input for table: guildmembers */
["guildmembers_pk_columns_input"]: {
	member_id: number
};
	/** select columns of table "guildmembers" */
["guildmembers_select_column"]:guildmembers_select_column;
	/** input type for updating data in table "guildmembers" */
["guildmembers_set_input"]: {
	avatar?: string | undefined | null,
	guild_id?: number | undefined | null,
	member_id?: number | undefined | null,
	nickname?: string | undefined | null,
	user_id?: number | undefined | null
};
	/** aggregate stddev on columns */
["guildmembers_stddev_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["guildmembers_stddev_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["guildmembers_stddev_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["guildmembers_sum_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** update columns of table "guildmembers" */
["guildmembers_update_column"]:guildmembers_update_column;
	/** aggregate var_pop on columns */
["guildmembers_var_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["guildmembers_var_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["guildmembers_variance_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** columns and relationships of "guilds" */
["guilds"]: AliasType<{
	alias?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
managers?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmanagers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmanagers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmanagers_bool_exp"] | undefined | null},ResolverInputTypes["guildmanagers"]],
managers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmanagers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmanagers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmanagers_bool_exp"] | undefined | null},ResolverInputTypes["guildmanagers_aggregate"]],
	moderator_role?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	preferred_locale?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
teams?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teams_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teams_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teams_bool_exp"] | undefined | null},ResolverInputTypes["teams"]],
teams_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teams_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teams_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teams_bool_exp"] | undefined | null},ResolverInputTypes["teams_aggregate"]],
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "guilds" */
["guilds_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["guilds_aggregate_fields"],
	nodes?:ResolverInputTypes["guilds"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "guilds" */
["guilds_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["guilds_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["guilds_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["guilds_max_fields"],
	min?:ResolverInputTypes["guilds_min_fields"],
	stddev?:ResolverInputTypes["guilds_stddev_fields"],
	stddev_pop?:ResolverInputTypes["guilds_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["guilds_stddev_samp_fields"],
	sum?:ResolverInputTypes["guilds_sum_fields"],
	var_pop?:ResolverInputTypes["guilds_var_pop_fields"],
	var_samp?:ResolverInputTypes["guilds_var_samp_fields"],
	variance?:ResolverInputTypes["guilds_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["guilds_avg_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "guilds". All fields are combined with a logical 'AND'. */
["guilds_bool_exp"]: {
	_and?: Array<ResolverInputTypes["guilds_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["guilds_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["guilds_bool_exp"]> | undefined | null,
	alias?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	created_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	deleted_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	description?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	guild_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	icon?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	manager_role?: ResolverInputTypes["bigint_comparison_exp"] | undefined | null,
	managers?: ResolverInputTypes["guildmanagers_bool_exp"] | undefined | null,
	moderator_role?: ResolverInputTypes["bigint_comparison_exp"] | undefined | null,
	name?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	preferred_locale?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	snowflake?: ResolverInputTypes["bigint_comparison_exp"] | undefined | null,
	teams?: ResolverInputTypes["teams_bool_exp"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null
};
	/** unique or primary key constraints on table "guilds" */
["guilds_constraint"]:guilds_constraint;
	/** input type for incrementing numeric columns in table "guilds" */
["guilds_inc_input"]: {
	guild_id?: number | undefined | null,
	manager_role?: ResolverInputTypes["bigint"] | undefined | null,
	moderator_role?: ResolverInputTypes["bigint"] | undefined | null,
	snowflake?: ResolverInputTypes["bigint"] | undefined | null
};
	/** input type for inserting data into table "guilds" */
["guilds_insert_input"]: {
	alias?: string | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	deleted_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	description?: string | undefined | null,
	guild_id?: number | undefined | null,
	icon?: string | undefined | null,
	manager_role?: ResolverInputTypes["bigint"] | undefined | null,
	managers?: ResolverInputTypes["guildmanagers_arr_rel_insert_input"] | undefined | null,
	moderator_role?: ResolverInputTypes["bigint"] | undefined | null,
	name?: string | undefined | null,
	preferred_locale?: string | undefined | null,
	snowflake?: ResolverInputTypes["bigint"] | undefined | null,
	teams?: ResolverInputTypes["teams_arr_rel_insert_input"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null
};
	/** aggregate max on columns */
["guilds_max_fields"]: AliasType<{
	alias?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	preferred_locale?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["guilds_min_fields"]: AliasType<{
	alias?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	preferred_locale?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** response of any mutation on the table "guilds" */
["guilds_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ResolverInputTypes["guilds"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "guilds" */
["guilds_on_conflict"]: {
	constraint: ResolverInputTypes["guilds_constraint"],
	update_columns: Array<ResolverInputTypes["guilds_update_column"]>,
	where?: ResolverInputTypes["guilds_bool_exp"] | undefined | null
};
	/** Ordering options when selecting data from "guilds". */
["guilds_order_by"]: {
	alias?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	deleted_at?: ResolverInputTypes["order_by"] | undefined | null,
	description?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	icon?: ResolverInputTypes["order_by"] | undefined | null,
	manager_role?: ResolverInputTypes["order_by"] | undefined | null,
	managers_aggregate?: ResolverInputTypes["guildmanagers_aggregate_order_by"] | undefined | null,
	moderator_role?: ResolverInputTypes["order_by"] | undefined | null,
	name?: ResolverInputTypes["order_by"] | undefined | null,
	preferred_locale?: ResolverInputTypes["order_by"] | undefined | null,
	snowflake?: ResolverInputTypes["order_by"] | undefined | null,
	teams_aggregate?: ResolverInputTypes["teams_aggregate_order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null
};
	/** primary key columns input for table: guilds */
["guilds_pk_columns_input"]: {
	guild_id: number
};
	/** select columns of table "guilds" */
["guilds_select_column"]:guilds_select_column;
	/** input type for updating data in table "guilds" */
["guilds_set_input"]: {
	alias?: string | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	deleted_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	description?: string | undefined | null,
	guild_id?: number | undefined | null,
	icon?: string | undefined | null,
	manager_role?: ResolverInputTypes["bigint"] | undefined | null,
	moderator_role?: ResolverInputTypes["bigint"] | undefined | null,
	name?: string | undefined | null,
	preferred_locale?: string | undefined | null,
	snowflake?: ResolverInputTypes["bigint"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null
};
	/** aggregate stddev on columns */
["guilds_stddev_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["guilds_stddev_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["guilds_stddev_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["guilds_sum_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** update columns of table "guilds" */
["guilds_update_column"]:guilds_update_column;
	/** aggregate var_pop on columns */
["guilds_var_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["guilds_var_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["guilds_variance_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	manager_role?:boolean | `@${string}`,
	moderator_role?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** columns and relationships of "guildwars2accounts" */
["guildwars2accounts"]: AliasType<{
	account_id?:boolean | `@${string}`,
	api_key?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	main?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	verified?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "guildwars2accounts" */
["guildwars2accounts_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["guildwars2accounts_aggregate_fields"],
	nodes?:ResolverInputTypes["guildwars2accounts"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "guildwars2accounts" */
["guildwars2accounts_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["guildwars2accounts_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["guildwars2accounts_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["guildwars2accounts_max_fields"],
	min?:ResolverInputTypes["guildwars2accounts_min_fields"],
	stddev?:ResolverInputTypes["guildwars2accounts_stddev_fields"],
	stddev_pop?:ResolverInputTypes["guildwars2accounts_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["guildwars2accounts_stddev_samp_fields"],
	sum?:ResolverInputTypes["guildwars2accounts_sum_fields"],
	var_pop?:ResolverInputTypes["guildwars2accounts_var_pop_fields"],
	var_samp?:ResolverInputTypes["guildwars2accounts_var_samp_fields"],
	variance?:ResolverInputTypes["guildwars2accounts_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "guildwars2accounts" */
["guildwars2accounts_aggregate_order_by"]: {
	avg?: ResolverInputTypes["guildwars2accounts_avg_order_by"] | undefined | null,
	count?: ResolverInputTypes["order_by"] | undefined | null,
	max?: ResolverInputTypes["guildwars2accounts_max_order_by"] | undefined | null,
	min?: ResolverInputTypes["guildwars2accounts_min_order_by"] | undefined | null,
	stddev?: ResolverInputTypes["guildwars2accounts_stddev_order_by"] | undefined | null,
	stddev_pop?: ResolverInputTypes["guildwars2accounts_stddev_pop_order_by"] | undefined | null,
	stddev_samp?: ResolverInputTypes["guildwars2accounts_stddev_samp_order_by"] | undefined | null,
	sum?: ResolverInputTypes["guildwars2accounts_sum_order_by"] | undefined | null,
	var_pop?: ResolverInputTypes["guildwars2accounts_var_pop_order_by"] | undefined | null,
	var_samp?: ResolverInputTypes["guildwars2accounts_var_samp_order_by"] | undefined | null,
	variance?: ResolverInputTypes["guildwars2accounts_variance_order_by"] | undefined | null
};
	/** input type for inserting array relation for remote table "guildwars2accounts" */
["guildwars2accounts_arr_rel_insert_input"]: {
	data: Array<ResolverInputTypes["guildwars2accounts_insert_input"]>,
	/** upsert condition */
	on_conflict?: ResolverInputTypes["guildwars2accounts_on_conflict"] | undefined | null
};
	/** aggregate avg on columns */
["guildwars2accounts_avg_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "guildwars2accounts" */
["guildwars2accounts_avg_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** Boolean expression to filter rows from the table "guildwars2accounts". All fields are combined with a logical 'AND'. */
["guildwars2accounts_bool_exp"]: {
	_and?: Array<ResolverInputTypes["guildwars2accounts_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["guildwars2accounts_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["guildwars2accounts_bool_exp"]> | undefined | null,
	account_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	api_key?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	created_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	main?: ResolverInputTypes["Boolean_comparison_exp"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	user_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	verified?: ResolverInputTypes["Boolean_comparison_exp"] | undefined | null
};
	/** unique or primary key constraints on table "guildwars2accounts" */
["guildwars2accounts_constraint"]:guildwars2accounts_constraint;
	/** input type for incrementing numeric columns in table "guildwars2accounts" */
["guildwars2accounts_inc_input"]: {
	account_id?: number | undefined | null,
	user_id?: number | undefined | null
};
	/** input type for inserting data into table "guildwars2accounts" */
["guildwars2accounts_insert_input"]: {
	account_id?: number | undefined | null,
	api_key?: string | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	main?: boolean | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	user_id?: number | undefined | null,
	verified?: boolean | undefined | null
};
	/** aggregate max on columns */
["guildwars2accounts_max_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	api_key?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "guildwars2accounts" */
["guildwars2accounts_max_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	api_key?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate min on columns */
["guildwars2accounts_min_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	api_key?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "guildwars2accounts" */
["guildwars2accounts_min_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	api_key?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** response of any mutation on the table "guildwars2accounts" */
["guildwars2accounts_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ResolverInputTypes["guildwars2accounts"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "guildwars2accounts" */
["guildwars2accounts_on_conflict"]: {
	constraint: ResolverInputTypes["guildwars2accounts_constraint"],
	update_columns: Array<ResolverInputTypes["guildwars2accounts_update_column"]>,
	where?: ResolverInputTypes["guildwars2accounts_bool_exp"] | undefined | null
};
	/** Ordering options when selecting data from "guildwars2accounts". */
["guildwars2accounts_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	api_key?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	main?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null,
	verified?: ResolverInputTypes["order_by"] | undefined | null
};
	/** primary key columns input for table: guildwars2accounts */
["guildwars2accounts_pk_columns_input"]: {
	account_id: number
};
	/** select columns of table "guildwars2accounts" */
["guildwars2accounts_select_column"]:guildwars2accounts_select_column;
	/** input type for updating data in table "guildwars2accounts" */
["guildwars2accounts_set_input"]: {
	account_id?: number | undefined | null,
	api_key?: string | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	main?: boolean | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	user_id?: number | undefined | null,
	verified?: boolean | undefined | null
};
	/** aggregate stddev on columns */
["guildwars2accounts_stddev_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_pop on columns */
["guildwars2accounts_stddev_pop_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_pop_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_samp on columns */
["guildwars2accounts_stddev_samp_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_samp_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate sum on columns */
["guildwars2accounts_sum_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "guildwars2accounts" */
["guildwars2accounts_sum_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** update columns of table "guildwars2accounts" */
["guildwars2accounts_update_column"]:guildwars2accounts_update_column;
	/** aggregate var_pop on columns */
["guildwars2accounts_var_pop_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "guildwars2accounts" */
["guildwars2accounts_var_pop_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate var_samp on columns */
["guildwars2accounts_var_samp_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "guildwars2accounts" */
["guildwars2accounts_var_samp_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate variance on columns */
["guildwars2accounts_variance_fields"]: AliasType<{
	account_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "guildwars2accounts" */
["guildwars2accounts_variance_order_by"]: {
	account_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** mutation root */
["mutation_root"]: AliasType<{
delete_guildmanagers?: [{	/** filter the rows which have to be deleted */
	where: ResolverInputTypes["guildmanagers_bool_exp"]},ResolverInputTypes["guildmanagers_mutation_response"]],
delete_guildmanagers_by_pk?: [{	manager_id: number},ResolverInputTypes["guildmanagers"]],
delete_guildmembers?: [{	/** filter the rows which have to be deleted */
	where: ResolverInputTypes["guildmembers_bool_exp"]},ResolverInputTypes["guildmembers_mutation_response"]],
delete_guildmembers_by_pk?: [{	member_id: number},ResolverInputTypes["guildmembers"]],
delete_guilds?: [{	/** filter the rows which have to be deleted */
	where: ResolverInputTypes["guilds_bool_exp"]},ResolverInputTypes["guilds_mutation_response"]],
delete_guilds_by_pk?: [{	guild_id: number},ResolverInputTypes["guilds"]],
delete_guildwars2accounts?: [{	/** filter the rows which have to be deleted */
	where: ResolverInputTypes["guildwars2accounts_bool_exp"]},ResolverInputTypes["guildwars2accounts_mutation_response"]],
delete_guildwars2accounts_by_pk?: [{	account_id: number},ResolverInputTypes["guildwars2accounts"]],
delete_profiles?: [{	/** filter the rows which have to be deleted */
	where: ResolverInputTypes["profiles_bool_exp"]},ResolverInputTypes["profiles_mutation_response"]],
delete_profiles_by_pk?: [{	profile_id: number},ResolverInputTypes["profiles"]],
delete_teammembers?: [{	/** filter the rows which have to be deleted */
	where: ResolverInputTypes["teammembers_bool_exp"]},ResolverInputTypes["teammembers_mutation_response"]],
delete_teammembers_by_pk?: [{	member_id: number},ResolverInputTypes["teammembers"]],
delete_teams?: [{	/** filter the rows which have to be deleted */
	where: ResolverInputTypes["teams_bool_exp"]},ResolverInputTypes["teams_mutation_response"]],
delete_teams_by_pk?: [{	team_id: number},ResolverInputTypes["teams"]],
delete_teamtimes?: [{	/** filter the rows which have to be deleted */
	where: ResolverInputTypes["teamtimes_bool_exp"]},ResolverInputTypes["teamtimes_mutation_response"]],
delete_teamtimes_by_pk?: [{	time_id: number},ResolverInputTypes["teamtimes"]],
delete_users?: [{	/** filter the rows which have to be deleted */
	where: ResolverInputTypes["users_bool_exp"]},ResolverInputTypes["users_mutation_response"]],
delete_users_by_pk?: [{	user_id: number},ResolverInputTypes["users"]],
insert_guildmanagers?: [{	/** the rows to be inserted */
	objects: Array<ResolverInputTypes["guildmanagers_insert_input"]>,	/** upsert condition */
	on_conflict?: ResolverInputTypes["guildmanagers_on_conflict"] | undefined | null},ResolverInputTypes["guildmanagers_mutation_response"]],
insert_guildmanagers_one?: [{	/** the row to be inserted */
	object: ResolverInputTypes["guildmanagers_insert_input"],	/** upsert condition */
	on_conflict?: ResolverInputTypes["guildmanagers_on_conflict"] | undefined | null},ResolverInputTypes["guildmanagers"]],
insert_guildmembers?: [{	/** the rows to be inserted */
	objects: Array<ResolverInputTypes["guildmembers_insert_input"]>,	/** upsert condition */
	on_conflict?: ResolverInputTypes["guildmembers_on_conflict"] | undefined | null},ResolverInputTypes["guildmembers_mutation_response"]],
insert_guildmembers_one?: [{	/** the row to be inserted */
	object: ResolverInputTypes["guildmembers_insert_input"],	/** upsert condition */
	on_conflict?: ResolverInputTypes["guildmembers_on_conflict"] | undefined | null},ResolverInputTypes["guildmembers"]],
insert_guilds?: [{	/** the rows to be inserted */
	objects: Array<ResolverInputTypes["guilds_insert_input"]>,	/** upsert condition */
	on_conflict?: ResolverInputTypes["guilds_on_conflict"] | undefined | null},ResolverInputTypes["guilds_mutation_response"]],
insert_guilds_one?: [{	/** the row to be inserted */
	object: ResolverInputTypes["guilds_insert_input"],	/** upsert condition */
	on_conflict?: ResolverInputTypes["guilds_on_conflict"] | undefined | null},ResolverInputTypes["guilds"]],
insert_guildwars2accounts?: [{	/** the rows to be inserted */
	objects: Array<ResolverInputTypes["guildwars2accounts_insert_input"]>,	/** upsert condition */
	on_conflict?: ResolverInputTypes["guildwars2accounts_on_conflict"] | undefined | null},ResolverInputTypes["guildwars2accounts_mutation_response"]],
insert_guildwars2accounts_one?: [{	/** the row to be inserted */
	object: ResolverInputTypes["guildwars2accounts_insert_input"],	/** upsert condition */
	on_conflict?: ResolverInputTypes["guildwars2accounts_on_conflict"] | undefined | null},ResolverInputTypes["guildwars2accounts"]],
insert_profiles?: [{	/** the rows to be inserted */
	objects: Array<ResolverInputTypes["profiles_insert_input"]>,	/** upsert condition */
	on_conflict?: ResolverInputTypes["profiles_on_conflict"] | undefined | null},ResolverInputTypes["profiles_mutation_response"]],
insert_profiles_one?: [{	/** the row to be inserted */
	object: ResolverInputTypes["profiles_insert_input"],	/** upsert condition */
	on_conflict?: ResolverInputTypes["profiles_on_conflict"] | undefined | null},ResolverInputTypes["profiles"]],
insert_teammembers?: [{	/** the rows to be inserted */
	objects: Array<ResolverInputTypes["teammembers_insert_input"]>,	/** upsert condition */
	on_conflict?: ResolverInputTypes["teammembers_on_conflict"] | undefined | null},ResolverInputTypes["teammembers_mutation_response"]],
insert_teammembers_one?: [{	/** the row to be inserted */
	object: ResolverInputTypes["teammembers_insert_input"],	/** upsert condition */
	on_conflict?: ResolverInputTypes["teammembers_on_conflict"] | undefined | null},ResolverInputTypes["teammembers"]],
insert_teams?: [{	/** the rows to be inserted */
	objects: Array<ResolverInputTypes["teams_insert_input"]>,	/** upsert condition */
	on_conflict?: ResolverInputTypes["teams_on_conflict"] | undefined | null},ResolverInputTypes["teams_mutation_response"]],
insert_teams_one?: [{	/** the row to be inserted */
	object: ResolverInputTypes["teams_insert_input"],	/** upsert condition */
	on_conflict?: ResolverInputTypes["teams_on_conflict"] | undefined | null},ResolverInputTypes["teams"]],
insert_teamtimes?: [{	/** the rows to be inserted */
	objects: Array<ResolverInputTypes["teamtimes_insert_input"]>,	/** upsert condition */
	on_conflict?: ResolverInputTypes["teamtimes_on_conflict"] | undefined | null},ResolverInputTypes["teamtimes_mutation_response"]],
insert_teamtimes_one?: [{	/** the row to be inserted */
	object: ResolverInputTypes["teamtimes_insert_input"],	/** upsert condition */
	on_conflict?: ResolverInputTypes["teamtimes_on_conflict"] | undefined | null},ResolverInputTypes["teamtimes"]],
insert_users?: [{	/** the rows to be inserted */
	objects: Array<ResolverInputTypes["users_insert_input"]>,	/** upsert condition */
	on_conflict?: ResolverInputTypes["users_on_conflict"] | undefined | null},ResolverInputTypes["users_mutation_response"]],
insert_users_one?: [{	/** the row to be inserted */
	object: ResolverInputTypes["users_insert_input"],	/** upsert condition */
	on_conflict?: ResolverInputTypes["users_on_conflict"] | undefined | null},ResolverInputTypes["users"]],
update_guildmanagers?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["guildmanagers_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["guildmanagers_set_input"] | undefined | null,	/** filter the rows which have to be updated */
	where: ResolverInputTypes["guildmanagers_bool_exp"]},ResolverInputTypes["guildmanagers_mutation_response"]],
update_guildmanagers_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["guildmanagers_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["guildmanagers_set_input"] | undefined | null,	pk_columns: ResolverInputTypes["guildmanagers_pk_columns_input"]},ResolverInputTypes["guildmanagers"]],
update_guildmembers?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["guildmembers_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["guildmembers_set_input"] | undefined | null,	/** filter the rows which have to be updated */
	where: ResolverInputTypes["guildmembers_bool_exp"]},ResolverInputTypes["guildmembers_mutation_response"]],
update_guildmembers_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["guildmembers_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["guildmembers_set_input"] | undefined | null,	pk_columns: ResolverInputTypes["guildmembers_pk_columns_input"]},ResolverInputTypes["guildmembers"]],
update_guilds?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["guilds_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["guilds_set_input"] | undefined | null,	/** filter the rows which have to be updated */
	where: ResolverInputTypes["guilds_bool_exp"]},ResolverInputTypes["guilds_mutation_response"]],
update_guilds_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["guilds_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["guilds_set_input"] | undefined | null,	pk_columns: ResolverInputTypes["guilds_pk_columns_input"]},ResolverInputTypes["guilds"]],
update_guildwars2accounts?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["guildwars2accounts_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["guildwars2accounts_set_input"] | undefined | null,	/** filter the rows which have to be updated */
	where: ResolverInputTypes["guildwars2accounts_bool_exp"]},ResolverInputTypes["guildwars2accounts_mutation_response"]],
update_guildwars2accounts_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["guildwars2accounts_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["guildwars2accounts_set_input"] | undefined | null,	pk_columns: ResolverInputTypes["guildwars2accounts_pk_columns_input"]},ResolverInputTypes["guildwars2accounts"]],
update_profiles?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["profiles_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["profiles_set_input"] | undefined | null,	/** filter the rows which have to be updated */
	where: ResolverInputTypes["profiles_bool_exp"]},ResolverInputTypes["profiles_mutation_response"]],
update_profiles_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["profiles_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["profiles_set_input"] | undefined | null,	pk_columns: ResolverInputTypes["profiles_pk_columns_input"]},ResolverInputTypes["profiles"]],
update_teammembers?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["teammembers_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["teammembers_set_input"] | undefined | null,	/** filter the rows which have to be updated */
	where: ResolverInputTypes["teammembers_bool_exp"]},ResolverInputTypes["teammembers_mutation_response"]],
update_teammembers_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["teammembers_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["teammembers_set_input"] | undefined | null,	pk_columns: ResolverInputTypes["teammembers_pk_columns_input"]},ResolverInputTypes["teammembers"]],
update_teams?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["teams_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["teams_set_input"] | undefined | null,	/** filter the rows which have to be updated */
	where: ResolverInputTypes["teams_bool_exp"]},ResolverInputTypes["teams_mutation_response"]],
update_teams_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["teams_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["teams_set_input"] | undefined | null,	pk_columns: ResolverInputTypes["teams_pk_columns_input"]},ResolverInputTypes["teams"]],
update_teamtimes?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["teamtimes_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["teamtimes_set_input"] | undefined | null,	/** filter the rows which have to be updated */
	where: ResolverInputTypes["teamtimes_bool_exp"]},ResolverInputTypes["teamtimes_mutation_response"]],
update_teamtimes_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["teamtimes_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["teamtimes_set_input"] | undefined | null,	pk_columns: ResolverInputTypes["teamtimes_pk_columns_input"]},ResolverInputTypes["teamtimes"]],
update_users?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["users_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["users_set_input"] | undefined | null,	/** filter the rows which have to be updated */
	where: ResolverInputTypes["users_bool_exp"]},ResolverInputTypes["users_mutation_response"]],
update_users_by_pk?: [{	/** increments the numeric columns with given value of the filtered values */
	_inc?: ResolverInputTypes["users_inc_input"] | undefined | null,	/** sets the columns of the filtered rows to the given values */
	_set?: ResolverInputTypes["users_set_input"] | undefined | null,	pk_columns: ResolverInputTypes["users_pk_columns_input"]},ResolverInputTypes["users"]],
		__typename?: boolean | `@${string}`
}>;
	/** column ordering options */
["order_by"]:order_by;
	/** columns and relationships of "profiles" */
["profiles"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	/** An object relationship */
	user?:ResolverInputTypes["users"],
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "profiles" */
["profiles_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["profiles_aggregate_fields"],
	nodes?:ResolverInputTypes["profiles"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "profiles" */
["profiles_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["profiles_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["profiles_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["profiles_max_fields"],
	min?:ResolverInputTypes["profiles_min_fields"],
	stddev?:ResolverInputTypes["profiles_stddev_fields"],
	stddev_pop?:ResolverInputTypes["profiles_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["profiles_stddev_samp_fields"],
	sum?:ResolverInputTypes["profiles_sum_fields"],
	var_pop?:ResolverInputTypes["profiles_var_pop_fields"],
	var_samp?:ResolverInputTypes["profiles_var_samp_fields"],
	variance?:ResolverInputTypes["profiles_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["profiles_avg_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "profiles". All fields are combined with a logical 'AND'. */
["profiles_bool_exp"]: {
	_and?: Array<ResolverInputTypes["profiles_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["profiles_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["profiles_bool_exp"]> | undefined | null,
	avatar?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	created_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	profile_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	user?: ResolverInputTypes["users_bool_exp"] | undefined | null,
	user_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null
};
	/** unique or primary key constraints on table "profiles" */
["profiles_constraint"]:profiles_constraint;
	/** input type for incrementing numeric columns in table "profiles" */
["profiles_inc_input"]: {
	profile_id?: number | undefined | null,
	user_id?: number | undefined | null
};
	/** input type for inserting data into table "profiles" */
["profiles_insert_input"]: {
	avatar?: string | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	profile_id?: number | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	user?: ResolverInputTypes["users_obj_rel_insert_input"] | undefined | null,
	user_id?: number | undefined | null
};
	/** aggregate max on columns */
["profiles_max_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["profiles_min_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** response of any mutation on the table "profiles" */
["profiles_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ResolverInputTypes["profiles"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "profiles" */
["profiles_on_conflict"]: {
	constraint: ResolverInputTypes["profiles_constraint"],
	update_columns: Array<ResolverInputTypes["profiles_update_column"]>,
	where?: ResolverInputTypes["profiles_bool_exp"] | undefined | null
};
	/** Ordering options when selecting data from "profiles". */
["profiles_order_by"]: {
	avatar?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	profile_id?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null,
	user?: ResolverInputTypes["users_order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** primary key columns input for table: profiles */
["profiles_pk_columns_input"]: {
	profile_id: number
};
	/** select columns of table "profiles" */
["profiles_select_column"]:profiles_select_column;
	/** input type for updating data in table "profiles" */
["profiles_set_input"]: {
	avatar?: string | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	profile_id?: number | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	user_id?: number | undefined | null
};
	/** aggregate stddev on columns */
["profiles_stddev_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["profiles_stddev_pop_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["profiles_stddev_samp_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["profiles_sum_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** update columns of table "profiles" */
["profiles_update_column"]:profiles_update_column;
	/** aggregate var_pop on columns */
["profiles_var_pop_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["profiles_var_samp_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["profiles_variance_fields"]: AliasType<{
	profile_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	["query_root"]: AliasType<{
guildmanagers?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmanagers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmanagers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmanagers_bool_exp"] | undefined | null},ResolverInputTypes["guildmanagers"]],
guildmanagers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmanagers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmanagers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmanagers_bool_exp"] | undefined | null},ResolverInputTypes["guildmanagers_aggregate"]],
guildmanagers_by_pk?: [{	manager_id: number},ResolverInputTypes["guildmanagers"]],
guildmembers?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmembers_bool_exp"] | undefined | null},ResolverInputTypes["guildmembers"]],
guildmembers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmembers_bool_exp"] | undefined | null},ResolverInputTypes["guildmembers_aggregate"]],
guildmembers_by_pk?: [{	member_id: number},ResolverInputTypes["guildmembers"]],
guilds?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guilds_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guilds_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guilds_bool_exp"] | undefined | null},ResolverInputTypes["guilds"]],
guilds_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guilds_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guilds_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guilds_bool_exp"] | undefined | null},ResolverInputTypes["guilds_aggregate"]],
guilds_by_pk?: [{	guild_id: number},ResolverInputTypes["guilds"]],
guildwars2accounts?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildwars2accounts_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildwars2accounts_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildwars2accounts_bool_exp"] | undefined | null},ResolverInputTypes["guildwars2accounts"]],
guildwars2accounts_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildwars2accounts_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildwars2accounts_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildwars2accounts_bool_exp"] | undefined | null},ResolverInputTypes["guildwars2accounts_aggregate"]],
guildwars2accounts_by_pk?: [{	account_id: number},ResolverInputTypes["guildwars2accounts"]],
profiles?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["profiles_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["profiles_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["profiles_bool_exp"] | undefined | null},ResolverInputTypes["profiles"]],
profiles_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["profiles_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["profiles_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["profiles_bool_exp"] | undefined | null},ResolverInputTypes["profiles_aggregate"]],
profiles_by_pk?: [{	profile_id: number},ResolverInputTypes["profiles"]],
teammembers?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teammembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teammembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null},ResolverInputTypes["teammembers"]],
teammembers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teammembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teammembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null},ResolverInputTypes["teammembers_aggregate"]],
teammembers_by_pk?: [{	member_id: number},ResolverInputTypes["teammembers"]],
teams?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teams_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teams_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teams_bool_exp"] | undefined | null},ResolverInputTypes["teams"]],
teams_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teams_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teams_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teams_bool_exp"] | undefined | null},ResolverInputTypes["teams_aggregate"]],
teams_by_pk?: [{	team_id: number},ResolverInputTypes["teams"]],
teamtimes?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teamtimes_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teamtimes_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teamtimes_bool_exp"] | undefined | null},ResolverInputTypes["teamtimes"]],
teamtimes_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teamtimes_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teamtimes_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teamtimes_bool_exp"] | undefined | null},ResolverInputTypes["teamtimes_aggregate"]],
teamtimes_by_pk?: [{	time_id: number},ResolverInputTypes["teamtimes"]],
usermemberships?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["usermemberships_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["usermemberships_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["usermemberships_bool_exp"] | undefined | null},ResolverInputTypes["usermemberships"]],
usermemberships_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["usermemberships_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["usermemberships_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["usermemberships_bool_exp"] | undefined | null},ResolverInputTypes["usermemberships_aggregate"]],
userprofiles?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["userprofiles_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["userprofiles_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["userprofiles_bool_exp"] | undefined | null},ResolverInputTypes["userprofiles"]],
userprofiles_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["userprofiles_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["userprofiles_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["userprofiles_bool_exp"] | undefined | null},ResolverInputTypes["userprofiles_aggregate"]],
users?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["users_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["users_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["users_bool_exp"] | undefined | null},ResolverInputTypes["users"]],
users_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["users_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["users_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["users_bool_exp"] | undefined | null},ResolverInputTypes["users_aggregate"]],
users_by_pk?: [{	user_id: number},ResolverInputTypes["users"]],
		__typename?: boolean | `@${string}`
}>;
	["smallint"]:unknown;
	/** Boolean expression to compare columns of type "smallint". All fields are combined with logical 'AND'. */
["smallint_comparison_exp"]: {
	_eq?: ResolverInputTypes["smallint"] | undefined | null,
	_gt?: ResolverInputTypes["smallint"] | undefined | null,
	_gte?: ResolverInputTypes["smallint"] | undefined | null,
	_in?: Array<ResolverInputTypes["smallint"]> | undefined | null,
	_is_null?: boolean | undefined | null,
	_lt?: ResolverInputTypes["smallint"] | undefined | null,
	_lte?: ResolverInputTypes["smallint"] | undefined | null,
	_neq?: ResolverInputTypes["smallint"] | undefined | null,
	_nin?: Array<ResolverInputTypes["smallint"]> | undefined | null
};
	["subscription_root"]: AliasType<{
guildmanagers?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmanagers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmanagers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmanagers_bool_exp"] | undefined | null},ResolverInputTypes["guildmanagers"]],
guildmanagers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmanagers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmanagers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmanagers_bool_exp"] | undefined | null},ResolverInputTypes["guildmanagers_aggregate"]],
guildmanagers_by_pk?: [{	manager_id: number},ResolverInputTypes["guildmanagers"]],
guildmembers?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmembers_bool_exp"] | undefined | null},ResolverInputTypes["guildmembers"]],
guildmembers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildmembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildmembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildmembers_bool_exp"] | undefined | null},ResolverInputTypes["guildmembers_aggregate"]],
guildmembers_by_pk?: [{	member_id: number},ResolverInputTypes["guildmembers"]],
guilds?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guilds_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guilds_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guilds_bool_exp"] | undefined | null},ResolverInputTypes["guilds"]],
guilds_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guilds_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guilds_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guilds_bool_exp"] | undefined | null},ResolverInputTypes["guilds_aggregate"]],
guilds_by_pk?: [{	guild_id: number},ResolverInputTypes["guilds"]],
guildwars2accounts?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildwars2accounts_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildwars2accounts_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildwars2accounts_bool_exp"] | undefined | null},ResolverInputTypes["guildwars2accounts"]],
guildwars2accounts_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildwars2accounts_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildwars2accounts_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildwars2accounts_bool_exp"] | undefined | null},ResolverInputTypes["guildwars2accounts_aggregate"]],
guildwars2accounts_by_pk?: [{	account_id: number},ResolverInputTypes["guildwars2accounts"]],
profiles?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["profiles_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["profiles_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["profiles_bool_exp"] | undefined | null},ResolverInputTypes["profiles"]],
profiles_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["profiles_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["profiles_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["profiles_bool_exp"] | undefined | null},ResolverInputTypes["profiles_aggregate"]],
profiles_by_pk?: [{	profile_id: number},ResolverInputTypes["profiles"]],
teammembers?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teammembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teammembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null},ResolverInputTypes["teammembers"]],
teammembers_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teammembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teammembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null},ResolverInputTypes["teammembers_aggregate"]],
teammembers_by_pk?: [{	member_id: number},ResolverInputTypes["teammembers"]],
teams?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teams_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teams_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teams_bool_exp"] | undefined | null},ResolverInputTypes["teams"]],
teams_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teams_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teams_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teams_bool_exp"] | undefined | null},ResolverInputTypes["teams_aggregate"]],
teams_by_pk?: [{	team_id: number},ResolverInputTypes["teams"]],
teamtimes?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teamtimes_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teamtimes_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teamtimes_bool_exp"] | undefined | null},ResolverInputTypes["teamtimes"]],
teamtimes_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teamtimes_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teamtimes_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teamtimes_bool_exp"] | undefined | null},ResolverInputTypes["teamtimes_aggregate"]],
teamtimes_by_pk?: [{	time_id: number},ResolverInputTypes["teamtimes"]],
usermemberships?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["usermemberships_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["usermemberships_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["usermemberships_bool_exp"] | undefined | null},ResolverInputTypes["usermemberships"]],
usermemberships_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["usermemberships_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["usermemberships_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["usermemberships_bool_exp"] | undefined | null},ResolverInputTypes["usermemberships_aggregate"]],
userprofiles?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["userprofiles_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["userprofiles_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["userprofiles_bool_exp"] | undefined | null},ResolverInputTypes["userprofiles"]],
userprofiles_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["userprofiles_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["userprofiles_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["userprofiles_bool_exp"] | undefined | null},ResolverInputTypes["userprofiles_aggregate"]],
users?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["users_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["users_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["users_bool_exp"] | undefined | null},ResolverInputTypes["users"]],
users_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["users_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["users_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["users_bool_exp"] | undefined | null},ResolverInputTypes["users_aggregate"]],
users_by_pk?: [{	user_id: number},ResolverInputTypes["users"]],
		__typename?: boolean | `@${string}`
}>;
	["teammemberrole"]:unknown;
	/** Boolean expression to compare columns of type "teammemberrole". All fields are combined with logical 'AND'. */
["teammemberrole_comparison_exp"]: {
	_eq?: ResolverInputTypes["teammemberrole"] | undefined | null,
	_gt?: ResolverInputTypes["teammemberrole"] | undefined | null,
	_gte?: ResolverInputTypes["teammemberrole"] | undefined | null,
	_in?: Array<ResolverInputTypes["teammemberrole"]> | undefined | null,
	_is_null?: boolean | undefined | null,
	_lt?: ResolverInputTypes["teammemberrole"] | undefined | null,
	_lte?: ResolverInputTypes["teammemberrole"] | undefined | null,
	_neq?: ResolverInputTypes["teammemberrole"] | undefined | null,
	_nin?: Array<ResolverInputTypes["teammemberrole"]> | undefined | null
};
	/** columns and relationships of "teammembers" */
["teammembers"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	/** An object relationship */
	team?:ResolverInputTypes["teams"],
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	/** An object relationship */
	user?:ResolverInputTypes["users"],
	user_id?:boolean | `@${string}`,
	visibility?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "teammembers" */
["teammembers_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["teammembers_aggregate_fields"],
	nodes?:ResolverInputTypes["teammembers"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "teammembers" */
["teammembers_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["teammembers_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["teammembers_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["teammembers_max_fields"],
	min?:ResolverInputTypes["teammembers_min_fields"],
	stddev?:ResolverInputTypes["teammembers_stddev_fields"],
	stddev_pop?:ResolverInputTypes["teammembers_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["teammembers_stddev_samp_fields"],
	sum?:ResolverInputTypes["teammembers_sum_fields"],
	var_pop?:ResolverInputTypes["teammembers_var_pop_fields"],
	var_samp?:ResolverInputTypes["teammembers_var_samp_fields"],
	variance?:ResolverInputTypes["teammembers_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "teammembers" */
["teammembers_aggregate_order_by"]: {
	avg?: ResolverInputTypes["teammembers_avg_order_by"] | undefined | null,
	count?: ResolverInputTypes["order_by"] | undefined | null,
	max?: ResolverInputTypes["teammembers_max_order_by"] | undefined | null,
	min?: ResolverInputTypes["teammembers_min_order_by"] | undefined | null,
	stddev?: ResolverInputTypes["teammembers_stddev_order_by"] | undefined | null,
	stddev_pop?: ResolverInputTypes["teammembers_stddev_pop_order_by"] | undefined | null,
	stddev_samp?: ResolverInputTypes["teammembers_stddev_samp_order_by"] | undefined | null,
	sum?: ResolverInputTypes["teammembers_sum_order_by"] | undefined | null,
	var_pop?: ResolverInputTypes["teammembers_var_pop_order_by"] | undefined | null,
	var_samp?: ResolverInputTypes["teammembers_var_samp_order_by"] | undefined | null,
	variance?: ResolverInputTypes["teammembers_variance_order_by"] | undefined | null
};
	/** input type for inserting array relation for remote table "teammembers" */
["teammembers_arr_rel_insert_input"]: {
	data: Array<ResolverInputTypes["teammembers_insert_input"]>,
	/** upsert condition */
	on_conflict?: ResolverInputTypes["teammembers_on_conflict"] | undefined | null
};
	/** aggregate avg on columns */
["teammembers_avg_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "teammembers" */
["teammembers_avg_order_by"]: {
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** Boolean expression to filter rows from the table "teammembers". All fields are combined with a logical 'AND'. */
["teammembers_bool_exp"]: {
	_and?: Array<ResolverInputTypes["teammembers_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["teammembers_bool_exp"]> | undefined | null,
	avatar?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	created_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	member_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	nickname?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	role?: ResolverInputTypes["teammemberrole_comparison_exp"] | undefined | null,
	team?: ResolverInputTypes["teams_bool_exp"] | undefined | null,
	team_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	user?: ResolverInputTypes["users_bool_exp"] | undefined | null,
	user_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	visibility?: ResolverInputTypes["visibility_comparison_exp"] | undefined | null
};
	/** unique or primary key constraints on table "teammembers" */
["teammembers_constraint"]:teammembers_constraint;
	/** input type for incrementing numeric columns in table "teammembers" */
["teammembers_inc_input"]: {
	member_id?: number | undefined | null,
	team_id?: number | undefined | null,
	user_id?: number | undefined | null
};
	/** input type for inserting data into table "teammembers" */
["teammembers_insert_input"]: {
	avatar?: string | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	member_id?: number | undefined | null,
	nickname?: string | undefined | null,
	role?: ResolverInputTypes["teammemberrole"] | undefined | null,
	team?: ResolverInputTypes["teams_obj_rel_insert_input"] | undefined | null,
	team_id?: number | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	user?: ResolverInputTypes["users_obj_rel_insert_input"] | undefined | null,
	user_id?: number | undefined | null,
	visibility?: ResolverInputTypes["visibility"] | undefined | null
};
	/** aggregate max on columns */
["teammembers_max_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	visibility?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "teammembers" */
["teammembers_max_order_by"]: {
	avatar?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	nickname?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null,
	visibility?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate min on columns */
["teammembers_min_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	member_id?:boolean | `@${string}`,
	nickname?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	visibility?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "teammembers" */
["teammembers_min_order_by"]: {
	avatar?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	nickname?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null,
	visibility?: ResolverInputTypes["order_by"] | undefined | null
};
	/** response of any mutation on the table "teammembers" */
["teammembers_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ResolverInputTypes["teammembers"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "teammembers" */
["teammembers_on_conflict"]: {
	constraint: ResolverInputTypes["teammembers_constraint"],
	update_columns: Array<ResolverInputTypes["teammembers_update_column"]>,
	where?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null
};
	/** Ordering options when selecting data from "teammembers". */
["teammembers_order_by"]: {
	avatar?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	nickname?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team?: ResolverInputTypes["teams_order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null,
	user?: ResolverInputTypes["users_order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null,
	visibility?: ResolverInputTypes["order_by"] | undefined | null
};
	/** primary key columns input for table: teammembers */
["teammembers_pk_columns_input"]: {
	member_id: number
};
	/** select columns of table "teammembers" */
["teammembers_select_column"]:teammembers_select_column;
	/** input type for updating data in table "teammembers" */
["teammembers_set_input"]: {
	avatar?: string | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	member_id?: number | undefined | null,
	nickname?: string | undefined | null,
	role?: ResolverInputTypes["teammemberrole"] | undefined | null,
	team_id?: number | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	user_id?: number | undefined | null,
	visibility?: ResolverInputTypes["visibility"] | undefined | null
};
	/** aggregate stddev on columns */
["teammembers_stddev_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "teammembers" */
["teammembers_stddev_order_by"]: {
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_pop on columns */
["teammembers_stddev_pop_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "teammembers" */
["teammembers_stddev_pop_order_by"]: {
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_samp on columns */
["teammembers_stddev_samp_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "teammembers" */
["teammembers_stddev_samp_order_by"]: {
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate sum on columns */
["teammembers_sum_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "teammembers" */
["teammembers_sum_order_by"]: {
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** update columns of table "teammembers" */
["teammembers_update_column"]:teammembers_update_column;
	/** aggregate var_pop on columns */
["teammembers_var_pop_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "teammembers" */
["teammembers_var_pop_order_by"]: {
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate var_samp on columns */
["teammembers_var_samp_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "teammembers" */
["teammembers_var_samp_order_by"]: {
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate variance on columns */
["teammembers_variance_fields"]: AliasType<{
	member_id?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "teammembers" */
["teammembers_variance_order_by"]: {
	member_id?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** columns and relationships of "teams" */
["teams"]: AliasType<{
	alias?:boolean | `@${string}`,
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
members?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teammembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teammembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null},ResolverInputTypes["teammembers"]],
members_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teammembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teammembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null},ResolverInputTypes["teammembers_aggregate"]],
	name?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
times?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teamtimes_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teamtimes_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teamtimes_bool_exp"] | undefined | null},ResolverInputTypes["teamtimes"]],
times_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teamtimes_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teamtimes_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teamtimes_bool_exp"] | undefined | null},ResolverInputTypes["teamtimes_aggregate"]],
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "teams" */
["teams_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["teams_aggregate_fields"],
	nodes?:ResolverInputTypes["teams"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "teams" */
["teams_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["teams_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["teams_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["teams_max_fields"],
	min?:ResolverInputTypes["teams_min_fields"],
	stddev?:ResolverInputTypes["teams_stddev_fields"],
	stddev_pop?:ResolverInputTypes["teams_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["teams_stddev_samp_fields"],
	sum?:ResolverInputTypes["teams_sum_fields"],
	var_pop?:ResolverInputTypes["teams_var_pop_fields"],
	var_samp?:ResolverInputTypes["teams_var_samp_fields"],
	variance?:ResolverInputTypes["teams_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "teams" */
["teams_aggregate_order_by"]: {
	avg?: ResolverInputTypes["teams_avg_order_by"] | undefined | null,
	count?: ResolverInputTypes["order_by"] | undefined | null,
	max?: ResolverInputTypes["teams_max_order_by"] | undefined | null,
	min?: ResolverInputTypes["teams_min_order_by"] | undefined | null,
	stddev?: ResolverInputTypes["teams_stddev_order_by"] | undefined | null,
	stddev_pop?: ResolverInputTypes["teams_stddev_pop_order_by"] | undefined | null,
	stddev_samp?: ResolverInputTypes["teams_stddev_samp_order_by"] | undefined | null,
	sum?: ResolverInputTypes["teams_sum_order_by"] | undefined | null,
	var_pop?: ResolverInputTypes["teams_var_pop_order_by"] | undefined | null,
	var_samp?: ResolverInputTypes["teams_var_samp_order_by"] | undefined | null,
	variance?: ResolverInputTypes["teams_variance_order_by"] | undefined | null
};
	/** input type for inserting array relation for remote table "teams" */
["teams_arr_rel_insert_input"]: {
	data: Array<ResolverInputTypes["teams_insert_input"]>,
	/** upsert condition */
	on_conflict?: ResolverInputTypes["teams_on_conflict"] | undefined | null
};
	/** aggregate avg on columns */
["teams_avg_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "teams" */
["teams_avg_order_by"]: {
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** Boolean expression to filter rows from the table "teams". All fields are combined with a logical 'AND'. */
["teams_bool_exp"]: {
	_and?: Array<ResolverInputTypes["teams_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["teams_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["teams_bool_exp"]> | undefined | null,
	alias?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	channel?: ResolverInputTypes["bigint_comparison_exp"] | undefined | null,
	color?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	created_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	description?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	guild_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	icon?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	members?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null,
	name?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	role?: ResolverInputTypes["bigint_comparison_exp"] | undefined | null,
	team_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	times?: ResolverInputTypes["teamtimes_bool_exp"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null
};
	/** unique or primary key constraints on table "teams" */
["teams_constraint"]:teams_constraint;
	/** input type for incrementing numeric columns in table "teams" */
["teams_inc_input"]: {
	channel?: ResolverInputTypes["bigint"] | undefined | null,
	color?: number | undefined | null,
	guild_id?: number | undefined | null,
	role?: ResolverInputTypes["bigint"] | undefined | null,
	team_id?: number | undefined | null
};
	/** input type for inserting data into table "teams" */
["teams_insert_input"]: {
	alias?: string | undefined | null,
	channel?: ResolverInputTypes["bigint"] | undefined | null,
	color?: number | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	description?: string | undefined | null,
	guild_id?: number | undefined | null,
	icon?: string | undefined | null,
	members?: ResolverInputTypes["teammembers_arr_rel_insert_input"] | undefined | null,
	name?: string | undefined | null,
	role?: ResolverInputTypes["bigint"] | undefined | null,
	team_id?: number | undefined | null,
	times?: ResolverInputTypes["teamtimes_arr_rel_insert_input"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null
};
	/** aggregate max on columns */
["teams_max_fields"]: AliasType<{
	alias?:boolean | `@${string}`,
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "teams" */
["teams_max_order_by"]: {
	alias?: ResolverInputTypes["order_by"] | undefined | null,
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	description?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	icon?: ResolverInputTypes["order_by"] | undefined | null,
	name?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate min on columns */
["teams_min_fields"]: AliasType<{
	alias?:boolean | `@${string}`,
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	description?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	icon?:boolean | `@${string}`,
	name?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "teams" */
["teams_min_order_by"]: {
	alias?: ResolverInputTypes["order_by"] | undefined | null,
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	description?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	icon?: ResolverInputTypes["order_by"] | undefined | null,
	name?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null
};
	/** response of any mutation on the table "teams" */
["teams_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ResolverInputTypes["teams"],
		__typename?: boolean | `@${string}`
}>;
	/** input type for inserting object relation for remote table "teams" */
["teams_obj_rel_insert_input"]: {
	data: ResolverInputTypes["teams_insert_input"],
	/** upsert condition */
	on_conflict?: ResolverInputTypes["teams_on_conflict"] | undefined | null
};
	/** on_conflict condition type for table "teams" */
["teams_on_conflict"]: {
	constraint: ResolverInputTypes["teams_constraint"],
	update_columns: Array<ResolverInputTypes["teams_update_column"]>,
	where?: ResolverInputTypes["teams_bool_exp"] | undefined | null
};
	/** Ordering options when selecting data from "teams". */
["teams_order_by"]: {
	alias?: ResolverInputTypes["order_by"] | undefined | null,
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	description?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	icon?: ResolverInputTypes["order_by"] | undefined | null,
	members_aggregate?: ResolverInputTypes["teammembers_aggregate_order_by"] | undefined | null,
	name?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	times_aggregate?: ResolverInputTypes["teamtimes_aggregate_order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null
};
	/** primary key columns input for table: teams */
["teams_pk_columns_input"]: {
	team_id: number
};
	/** select columns of table "teams" */
["teams_select_column"]:teams_select_column;
	/** input type for updating data in table "teams" */
["teams_set_input"]: {
	alias?: string | undefined | null,
	channel?: ResolverInputTypes["bigint"] | undefined | null,
	color?: number | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	description?: string | undefined | null,
	guild_id?: number | undefined | null,
	icon?: string | undefined | null,
	name?: string | undefined | null,
	role?: ResolverInputTypes["bigint"] | undefined | null,
	team_id?: number | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null
};
	/** aggregate stddev on columns */
["teams_stddev_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "teams" */
["teams_stddev_order_by"]: {
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_pop on columns */
["teams_stddev_pop_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "teams" */
["teams_stddev_pop_order_by"]: {
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_samp on columns */
["teams_stddev_samp_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "teams" */
["teams_stddev_samp_order_by"]: {
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate sum on columns */
["teams_sum_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "teams" */
["teams_sum_order_by"]: {
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** update columns of table "teams" */
["teams_update_column"]:teams_update_column;
	/** aggregate var_pop on columns */
["teams_var_pop_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "teams" */
["teams_var_pop_order_by"]: {
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate var_samp on columns */
["teams_var_samp_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "teams" */
["teams_var_samp_order_by"]: {
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate variance on columns */
["teams_variance_fields"]: AliasType<{
	channel?:boolean | `@${string}`,
	color?:boolean | `@${string}`,
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "teams" */
["teams_variance_order_by"]: {
	channel?: ResolverInputTypes["order_by"] | undefined | null,
	color?: ResolverInputTypes["order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** columns and relationships of "teamtimes" */
["teamtimes"]: AliasType<{
	duration?:boolean | `@${string}`,
	team_id?:boolean | `@${string}`,
	time?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "teamtimes" */
["teamtimes_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["teamtimes_aggregate_fields"],
	nodes?:ResolverInputTypes["teamtimes"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "teamtimes" */
["teamtimes_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["teamtimes_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["teamtimes_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["teamtimes_max_fields"],
	min?:ResolverInputTypes["teamtimes_min_fields"],
	stddev?:ResolverInputTypes["teamtimes_stddev_fields"],
	stddev_pop?:ResolverInputTypes["teamtimes_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["teamtimes_stddev_samp_fields"],
	sum?:ResolverInputTypes["teamtimes_sum_fields"],
	var_pop?:ResolverInputTypes["teamtimes_var_pop_fields"],
	var_samp?:ResolverInputTypes["teamtimes_var_samp_fields"],
	variance?:ResolverInputTypes["teamtimes_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** order by aggregate values of table "teamtimes" */
["teamtimes_aggregate_order_by"]: {
	avg?: ResolverInputTypes["teamtimes_avg_order_by"] | undefined | null,
	count?: ResolverInputTypes["order_by"] | undefined | null,
	max?: ResolverInputTypes["teamtimes_max_order_by"] | undefined | null,
	min?: ResolverInputTypes["teamtimes_min_order_by"] | undefined | null,
	stddev?: ResolverInputTypes["teamtimes_stddev_order_by"] | undefined | null,
	stddev_pop?: ResolverInputTypes["teamtimes_stddev_pop_order_by"] | undefined | null,
	stddev_samp?: ResolverInputTypes["teamtimes_stddev_samp_order_by"] | undefined | null,
	sum?: ResolverInputTypes["teamtimes_sum_order_by"] | undefined | null,
	var_pop?: ResolverInputTypes["teamtimes_var_pop_order_by"] | undefined | null,
	var_samp?: ResolverInputTypes["teamtimes_var_samp_order_by"] | undefined | null,
	variance?: ResolverInputTypes["teamtimes_variance_order_by"] | undefined | null
};
	/** input type for inserting array relation for remote table "teamtimes" */
["teamtimes_arr_rel_insert_input"]: {
	data: Array<ResolverInputTypes["teamtimes_insert_input"]>,
	/** upsert condition */
	on_conflict?: ResolverInputTypes["teamtimes_on_conflict"] | undefined | null
};
	/** aggregate avg on columns */
["teamtimes_avg_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by avg() on columns of table "teamtimes" */
["teamtimes_avg_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** Boolean expression to filter rows from the table "teamtimes". All fields are combined with a logical 'AND'. */
["teamtimes_bool_exp"]: {
	_and?: Array<ResolverInputTypes["teamtimes_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["teamtimes_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["teamtimes_bool_exp"]> | undefined | null,
	duration?: ResolverInputTypes["time_comparison_exp"] | undefined | null,
	team_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	time?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	time_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null
};
	/** unique or primary key constraints on table "teamtimes" */
["teamtimes_constraint"]:teamtimes_constraint;
	/** input type for incrementing numeric columns in table "teamtimes" */
["teamtimes_inc_input"]: {
	team_id?: number | undefined | null,
	time_id?: number | undefined | null
};
	/** input type for inserting data into table "teamtimes" */
["teamtimes_insert_input"]: {
	duration?: ResolverInputTypes["time"] | undefined | null,
	team_id?: number | undefined | null,
	time?: ResolverInputTypes["timestamptz"] | undefined | null,
	time_id?: number | undefined | null
};
	/** aggregate max on columns */
["teamtimes_max_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by max() on columns of table "teamtimes" */
["teamtimes_max_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate min on columns */
["teamtimes_min_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by min() on columns of table "teamtimes" */
["teamtimes_min_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** response of any mutation on the table "teamtimes" */
["teamtimes_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ResolverInputTypes["teamtimes"],
		__typename?: boolean | `@${string}`
}>;
	/** on_conflict condition type for table "teamtimes" */
["teamtimes_on_conflict"]: {
	constraint: ResolverInputTypes["teamtimes_constraint"],
	update_columns: Array<ResolverInputTypes["teamtimes_update_column"]>,
	where?: ResolverInputTypes["teamtimes_bool_exp"] | undefined | null
};
	/** Ordering options when selecting data from "teamtimes". */
["teamtimes_order_by"]: {
	duration?: ResolverInputTypes["order_by"] | undefined | null,
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** primary key columns input for table: teamtimes */
["teamtimes_pk_columns_input"]: {
	time_id: number
};
	/** select columns of table "teamtimes" */
["teamtimes_select_column"]:teamtimes_select_column;
	/** input type for updating data in table "teamtimes" */
["teamtimes_set_input"]: {
	duration?: ResolverInputTypes["time"] | undefined | null,
	team_id?: number | undefined | null,
	time?: ResolverInputTypes["timestamptz"] | undefined | null,
	time_id?: number | undefined | null
};
	/** aggregate stddev on columns */
["teamtimes_stddev_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev() on columns of table "teamtimes" */
["teamtimes_stddev_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_pop on columns */
["teamtimes_stddev_pop_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_pop() on columns of table "teamtimes" */
["teamtimes_stddev_pop_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate stddev_samp on columns */
["teamtimes_stddev_samp_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by stddev_samp() on columns of table "teamtimes" */
["teamtimes_stddev_samp_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate sum on columns */
["teamtimes_sum_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by sum() on columns of table "teamtimes" */
["teamtimes_sum_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** update columns of table "teamtimes" */
["teamtimes_update_column"]:teamtimes_update_column;
	/** aggregate var_pop on columns */
["teamtimes_var_pop_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_pop() on columns of table "teamtimes" */
["teamtimes_var_pop_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate var_samp on columns */
["teamtimes_var_samp_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by var_samp() on columns of table "teamtimes" */
["teamtimes_var_samp_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** aggregate variance on columns */
["teamtimes_variance_fields"]: AliasType<{
	team_id?:boolean | `@${string}`,
	time_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** order by variance() on columns of table "teamtimes" */
["teamtimes_variance_order_by"]: {
	team_id?: ResolverInputTypes["order_by"] | undefined | null,
	time_id?: ResolverInputTypes["order_by"] | undefined | null
};
	["time"]:unknown;
	/** Boolean expression to compare columns of type "time". All fields are combined with logical 'AND'. */
["time_comparison_exp"]: {
	_eq?: ResolverInputTypes["time"] | undefined | null,
	_gt?: ResolverInputTypes["time"] | undefined | null,
	_gte?: ResolverInputTypes["time"] | undefined | null,
	_in?: Array<ResolverInputTypes["time"]> | undefined | null,
	_is_null?: boolean | undefined | null,
	_lt?: ResolverInputTypes["time"] | undefined | null,
	_lte?: ResolverInputTypes["time"] | undefined | null,
	_neq?: ResolverInputTypes["time"] | undefined | null,
	_nin?: Array<ResolverInputTypes["time"]> | undefined | null
};
	["timestamptz"]:unknown;
	/** Boolean expression to compare columns of type "timestamptz". All fields are combined with logical 'AND'. */
["timestamptz_comparison_exp"]: {
	_eq?: ResolverInputTypes["timestamptz"] | undefined | null,
	_gt?: ResolverInputTypes["timestamptz"] | undefined | null,
	_gte?: ResolverInputTypes["timestamptz"] | undefined | null,
	_in?: Array<ResolverInputTypes["timestamptz"]> | undefined | null,
	_is_null?: boolean | undefined | null,
	_lt?: ResolverInputTypes["timestamptz"] | undefined | null,
	_lte?: ResolverInputTypes["timestamptz"] | undefined | null,
	_neq?: ResolverInputTypes["timestamptz"] | undefined | null,
	_nin?: Array<ResolverInputTypes["timestamptz"]> | undefined | null
};
	/** columns and relationships of "usermemberships" */
["usermemberships"]: AliasType<{
	/** An object relationship */
	guild?:ResolverInputTypes["guilds"],
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	/** An object relationship */
	user?:ResolverInputTypes["users"],
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "usermemberships" */
["usermemberships_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["usermemberships_aggregate_fields"],
	nodes?:ResolverInputTypes["usermemberships"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "usermemberships" */
["usermemberships_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["usermemberships_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["usermemberships_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["usermemberships_max_fields"],
	min?:ResolverInputTypes["usermemberships_min_fields"],
	stddev?:ResolverInputTypes["usermemberships_stddev_fields"],
	stddev_pop?:ResolverInputTypes["usermemberships_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["usermemberships_stddev_samp_fields"],
	sum?:ResolverInputTypes["usermemberships_sum_fields"],
	var_pop?:ResolverInputTypes["usermemberships_var_pop_fields"],
	var_samp?:ResolverInputTypes["usermemberships_var_samp_fields"],
	variance?:ResolverInputTypes["usermemberships_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["usermemberships_avg_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "usermemberships". All fields are combined with a logical 'AND'. */
["usermemberships_bool_exp"]: {
	_and?: Array<ResolverInputTypes["usermemberships_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["usermemberships_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["usermemberships_bool_exp"]> | undefined | null,
	guild?: ResolverInputTypes["guilds_bool_exp"] | undefined | null,
	guild_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	role?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	user?: ResolverInputTypes["users_bool_exp"] | undefined | null,
	user_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null
};
	/** aggregate max on columns */
["usermemberships_max_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["usermemberships_min_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	role?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Ordering options when selecting data from "usermemberships". */
["usermemberships_order_by"]: {
	guild?: ResolverInputTypes["guilds_order_by"] | undefined | null,
	guild_id?: ResolverInputTypes["order_by"] | undefined | null,
	role?: ResolverInputTypes["order_by"] | undefined | null,
	user?: ResolverInputTypes["users_order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null
};
	/** select columns of table "usermemberships" */
["usermemberships_select_column"]:usermemberships_select_column;
	/** aggregate stddev on columns */
["usermemberships_stddev_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["usermemberships_stddev_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["usermemberships_stddev_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["usermemberships_sum_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_pop on columns */
["usermemberships_var_pop_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["usermemberships_var_samp_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["usermemberships_variance_fields"]: AliasType<{
	guild_id?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** columns and relationships of "userprofiles" */
["userprofiles"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	/** An object relationship */
	profile?:ResolverInputTypes["profiles"],
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	/** An object relationship */
	user?:ResolverInputTypes["users"],
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "userprofiles" */
["userprofiles_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["userprofiles_aggregate_fields"],
	nodes?:ResolverInputTypes["userprofiles"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "userprofiles" */
["userprofiles_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["userprofiles_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["userprofiles_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["userprofiles_max_fields"],
	min?:ResolverInputTypes["userprofiles_min_fields"],
	stddev?:ResolverInputTypes["userprofiles_stddev_fields"],
	stddev_pop?:ResolverInputTypes["userprofiles_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["userprofiles_stddev_samp_fields"],
	sum?:ResolverInputTypes["userprofiles_sum_fields"],
	var_pop?:ResolverInputTypes["userprofiles_var_pop_fields"],
	var_samp?:ResolverInputTypes["userprofiles_var_samp_fields"],
	variance?:ResolverInputTypes["userprofiles_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["userprofiles_avg_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "userprofiles". All fields are combined with a logical 'AND'. */
["userprofiles_bool_exp"]: {
	_and?: Array<ResolverInputTypes["userprofiles_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["userprofiles_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["userprofiles_bool_exp"]> | undefined | null,
	avatar?: ResolverInputTypes["String_comparison_exp"] | undefined | null,
	created_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	discriminator?: ResolverInputTypes["smallint_comparison_exp"] | undefined | null,
	profile?: ResolverInputTypes["profiles_bool_exp"] | undefined | null,
	profile_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	snowflake?: ResolverInputTypes["bigint_comparison_exp"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	user?: ResolverInputTypes["users_bool_exp"] | undefined | null,
	user_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	username?: ResolverInputTypes["String_comparison_exp"] | undefined | null
};
	/** aggregate max on columns */
["userprofiles_max_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["userprofiles_min_fields"]: AliasType<{
	avatar?:boolean | `@${string}`,
	created_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Ordering options when selecting data from "userprofiles". */
["userprofiles_order_by"]: {
	avatar?: ResolverInputTypes["order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	discriminator?: ResolverInputTypes["order_by"] | undefined | null,
	profile?: ResolverInputTypes["profiles_order_by"] | undefined | null,
	profile_id?: ResolverInputTypes["order_by"] | undefined | null,
	snowflake?: ResolverInputTypes["order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null,
	user?: ResolverInputTypes["users_order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null,
	username?: ResolverInputTypes["order_by"] | undefined | null
};
	/** select columns of table "userprofiles" */
["userprofiles_select_column"]:userprofiles_select_column;
	/** aggregate stddev on columns */
["userprofiles_stddev_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["userprofiles_stddev_pop_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["userprofiles_stddev_samp_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["userprofiles_sum_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_pop on columns */
["userprofiles_var_pop_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["userprofiles_var_samp_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["userprofiles_variance_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	profile_id?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** columns and relationships of "users" */
["users"]: AliasType<{
accounts?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildwars2accounts_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildwars2accounts_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildwars2accounts_bool_exp"] | undefined | null},ResolverInputTypes["guildwars2accounts"]],
accounts_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["guildwars2accounts_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["guildwars2accounts_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["guildwars2accounts_bool_exp"] | undefined | null},ResolverInputTypes["guildwars2accounts_aggregate"]],
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
teammemberships?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teammembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teammembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null},ResolverInputTypes["teammembers"]],
teammemberships_aggregate?: [{	/** distinct select on columns */
	distinct_on?: Array<ResolverInputTypes["teammembers_select_column"]> | undefined | null,	/** limit the number of rows returned */
	limit?: number | undefined | null,	/** skip the first n rows. Use only with order_by */
	offset?: number | undefined | null,	/** sort the rows by one or more columns */
	order_by?: Array<ResolverInputTypes["teammembers_order_by"]> | undefined | null,	/** filter the rows returned */
	where?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null},ResolverInputTypes["teammembers_aggregate"]],
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregated selection of "users" */
["users_aggregate"]: AliasType<{
	aggregate?:ResolverInputTypes["users_aggregate_fields"],
	nodes?:ResolverInputTypes["users"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate fields of "users" */
["users_aggregate_fields"]: AliasType<{
	avg?:ResolverInputTypes["users_avg_fields"],
count?: [{	columns?: Array<ResolverInputTypes["users_select_column"]> | undefined | null,	distinct?: boolean | undefined | null},boolean | `@${string}`],
	max?:ResolverInputTypes["users_max_fields"],
	min?:ResolverInputTypes["users_min_fields"],
	stddev?:ResolverInputTypes["users_stddev_fields"],
	stddev_pop?:ResolverInputTypes["users_stddev_pop_fields"],
	stddev_samp?:ResolverInputTypes["users_stddev_samp_fields"],
	sum?:ResolverInputTypes["users_sum_fields"],
	var_pop?:ResolverInputTypes["users_var_pop_fields"],
	var_samp?:ResolverInputTypes["users_var_samp_fields"],
	variance?:ResolverInputTypes["users_variance_fields"],
		__typename?: boolean | `@${string}`
}>;
	/** aggregate avg on columns */
["users_avg_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** Boolean expression to filter rows from the table "users". All fields are combined with a logical 'AND'. */
["users_bool_exp"]: {
	_and?: Array<ResolverInputTypes["users_bool_exp"]> | undefined | null,
	_not?: ResolverInputTypes["users_bool_exp"] | undefined | null,
	_or?: Array<ResolverInputTypes["users_bool_exp"]> | undefined | null,
	accounts?: ResolverInputTypes["guildwars2accounts_bool_exp"] | undefined | null,
	created_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	deleted_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	discriminator?: ResolverInputTypes["smallint_comparison_exp"] | undefined | null,
	snowflake?: ResolverInputTypes["bigint_comparison_exp"] | undefined | null,
	teammemberships?: ResolverInputTypes["teammembers_bool_exp"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz_comparison_exp"] | undefined | null,
	user_id?: ResolverInputTypes["Int_comparison_exp"] | undefined | null,
	username?: ResolverInputTypes["String_comparison_exp"] | undefined | null
};
	/** unique or primary key constraints on table "users" */
["users_constraint"]:users_constraint;
	/** input type for incrementing numeric columns in table "users" */
["users_inc_input"]: {
	discriminator?: ResolverInputTypes["smallint"] | undefined | null,
	snowflake?: ResolverInputTypes["bigint"] | undefined | null,
	user_id?: number | undefined | null
};
	/** input type for inserting data into table "users" */
["users_insert_input"]: {
	accounts?: ResolverInputTypes["guildwars2accounts_arr_rel_insert_input"] | undefined | null,
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	deleted_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	discriminator?: ResolverInputTypes["smallint"] | undefined | null,
	snowflake?: ResolverInputTypes["bigint"] | undefined | null,
	teammemberships?: ResolverInputTypes["teammembers_arr_rel_insert_input"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	user_id?: number | undefined | null,
	username?: string | undefined | null
};
	/** aggregate max on columns */
["users_max_fields"]: AliasType<{
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate min on columns */
["users_min_fields"]: AliasType<{
	created_at?:boolean | `@${string}`,
	deleted_at?:boolean | `@${string}`,
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	updated_at?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
	username?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** response of any mutation on the table "users" */
["users_mutation_response"]: AliasType<{
	/** number of rows affected by the mutation */
	affected_rows?:boolean | `@${string}`,
	/** data from the rows affected by the mutation */
	returning?:ResolverInputTypes["users"],
		__typename?: boolean | `@${string}`
}>;
	/** input type for inserting object relation for remote table "users" */
["users_obj_rel_insert_input"]: {
	data: ResolverInputTypes["users_insert_input"],
	/** upsert condition */
	on_conflict?: ResolverInputTypes["users_on_conflict"] | undefined | null
};
	/** on_conflict condition type for table "users" */
["users_on_conflict"]: {
	constraint: ResolverInputTypes["users_constraint"],
	update_columns: Array<ResolverInputTypes["users_update_column"]>,
	where?: ResolverInputTypes["users_bool_exp"] | undefined | null
};
	/** Ordering options when selecting data from "users". */
["users_order_by"]: {
	accounts_aggregate?: ResolverInputTypes["guildwars2accounts_aggregate_order_by"] | undefined | null,
	created_at?: ResolverInputTypes["order_by"] | undefined | null,
	deleted_at?: ResolverInputTypes["order_by"] | undefined | null,
	discriminator?: ResolverInputTypes["order_by"] | undefined | null,
	snowflake?: ResolverInputTypes["order_by"] | undefined | null,
	teammemberships_aggregate?: ResolverInputTypes["teammembers_aggregate_order_by"] | undefined | null,
	updated_at?: ResolverInputTypes["order_by"] | undefined | null,
	user_id?: ResolverInputTypes["order_by"] | undefined | null,
	username?: ResolverInputTypes["order_by"] | undefined | null
};
	/** primary key columns input for table: users */
["users_pk_columns_input"]: {
	user_id: number
};
	/** select columns of table "users" */
["users_select_column"]:users_select_column;
	/** input type for updating data in table "users" */
["users_set_input"]: {
	created_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	deleted_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	discriminator?: ResolverInputTypes["smallint"] | undefined | null,
	snowflake?: ResolverInputTypes["bigint"] | undefined | null,
	updated_at?: ResolverInputTypes["timestamptz"] | undefined | null,
	user_id?: number | undefined | null,
	username?: string | undefined | null
};
	/** aggregate stddev on columns */
["users_stddev_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_pop on columns */
["users_stddev_pop_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate stddev_samp on columns */
["users_stddev_samp_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate sum on columns */
["users_sum_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** update columns of table "users" */
["users_update_column"]:users_update_column;
	/** aggregate var_pop on columns */
["users_var_pop_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate var_samp on columns */
["users_var_samp_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	/** aggregate variance on columns */
["users_variance_fields"]: AliasType<{
	discriminator?:boolean | `@${string}`,
	snowflake?:boolean | `@${string}`,
	user_id?:boolean | `@${string}`,
		__typename?: boolean | `@${string}`
}>;
	["visibility"]:unknown;
	/** Boolean expression to compare columns of type "visibility". All fields are combined with logical 'AND'. */
["visibility_comparison_exp"]: {
	_eq?: ResolverInputTypes["visibility"] | undefined | null,
	_gt?: ResolverInputTypes["visibility"] | undefined | null,
	_gte?: ResolverInputTypes["visibility"] | undefined | null,
	_in?: Array<ResolverInputTypes["visibility"]> | undefined | null,
	_is_null?: boolean | undefined | null,
	_lt?: ResolverInputTypes["visibility"] | undefined | null,
	_lte?: ResolverInputTypes["visibility"] | undefined | null,
	_neq?: ResolverInputTypes["visibility"] | undefined | null,
	_nin?: Array<ResolverInputTypes["visibility"]> | undefined | null
}
  }

export type ModelTypes = {
    /** Boolean expression to compare columns of type "Boolean". All fields are combined with logical 'AND'. */
["Boolean_comparison_exp"]: {
	_eq?: boolean | undefined,
	_gt?: boolean | undefined,
	_gte?: boolean | undefined,
	_in?: Array<boolean> | undefined,
	_is_null?: boolean | undefined,
	_lt?: boolean | undefined,
	_lte?: boolean | undefined,
	_neq?: boolean | undefined,
	_nin?: Array<boolean> | undefined
};
	/** Boolean expression to compare columns of type "Int". All fields are combined with logical 'AND'. */
["Int_comparison_exp"]: {
	_eq?: number | undefined,
	_gt?: number | undefined,
	_gte?: number | undefined,
	_in?: Array<number> | undefined,
	_is_null?: boolean | undefined,
	_lt?: number | undefined,
	_lte?: number | undefined,
	_neq?: number | undefined,
	_nin?: Array<number> | undefined
};
	/** Boolean expression to compare columns of type "String". All fields are combined with logical 'AND'. */
["String_comparison_exp"]: {
	_eq?: string | undefined,
	_gt?: string | undefined,
	_gte?: string | undefined,
	/** does the column match the given case-insensitive pattern */
	_ilike?: string | undefined,
	_in?: Array<string> | undefined,
	/** does the column match the given POSIX regular expression, case insensitive */
	_iregex?: string | undefined,
	_is_null?: boolean | undefined,
	/** does the column match the given pattern */
	_like?: string | undefined,
	_lt?: string | undefined,
	_lte?: string | undefined,
	_neq?: string | undefined,
	/** does the column NOT match the given case-insensitive pattern */
	_nilike?: string | undefined,
	_nin?: Array<string> | undefined,
	/** does the column NOT match the given POSIX regular expression, case insensitive */
	_niregex?: string | undefined,
	/** does the column NOT match the given pattern */
	_nlike?: string | undefined,
	/** does the column NOT match the given POSIX regular expression, case sensitive */
	_nregex?: string | undefined,
	/** does the column NOT match the given SQL regular expression */
	_nsimilar?: string | undefined,
	/** does the column match the given POSIX regular expression, case sensitive */
	_regex?: string | undefined,
	/** does the column match the given SQL regular expression */
	_similar?: string | undefined
};
	["bigint"]:any;
	/** Boolean expression to compare columns of type "bigint". All fields are combined with logical 'AND'. */
["bigint_comparison_exp"]: {
	_eq?: ModelTypes["bigint"] | undefined,
	_gt?: ModelTypes["bigint"] | undefined,
	_gte?: ModelTypes["bigint"] | undefined,
	_in?: Array<ModelTypes["bigint"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: ModelTypes["bigint"] | undefined,
	_lte?: ModelTypes["bigint"] | undefined,
	_neq?: ModelTypes["bigint"] | undefined,
	_nin?: Array<ModelTypes["bigint"]> | undefined
};
	["guildmanagerrole"]:any;
	/** Boolean expression to compare columns of type "guildmanagerrole". All fields are combined with logical 'AND'. */
["guildmanagerrole_comparison_exp"]: {
	_eq?: ModelTypes["guildmanagerrole"] | undefined,
	_gt?: ModelTypes["guildmanagerrole"] | undefined,
	_gte?: ModelTypes["guildmanagerrole"] | undefined,
	_in?: Array<ModelTypes["guildmanagerrole"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: ModelTypes["guildmanagerrole"] | undefined,
	_lte?: ModelTypes["guildmanagerrole"] | undefined,
	_neq?: ModelTypes["guildmanagerrole"] | undefined,
	_nin?: Array<ModelTypes["guildmanagerrole"]> | undefined
};
	/** columns and relationships of "guildmanagers" */
["guildmanagers"]: {
		guild_id: number,
	manager_id: number,
	role: ModelTypes["guildmanagerrole"],
	/** An object relationship */
	user: ModelTypes["users"],
	user_id: number
};
	/** aggregated selection of "guildmanagers" */
["guildmanagers_aggregate"]: {
		aggregate?: ModelTypes["guildmanagers_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["guildmanagers"]>
};
	/** aggregate fields of "guildmanagers" */
["guildmanagers_aggregate_fields"]: {
		avg?: ModelTypes["guildmanagers_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["guildmanagers_max_fields"] | undefined,
	min?: ModelTypes["guildmanagers_min_fields"] | undefined,
	stddev?: ModelTypes["guildmanagers_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["guildmanagers_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["guildmanagers_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["guildmanagers_sum_fields"] | undefined,
	var_pop?: ModelTypes["guildmanagers_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["guildmanagers_var_samp_fields"] | undefined,
	variance?: ModelTypes["guildmanagers_variance_fields"] | undefined
};
	/** order by aggregate values of table "guildmanagers" */
["guildmanagers_aggregate_order_by"]: {
	avg?: ModelTypes["guildmanagers_avg_order_by"] | undefined,
	count?: ModelTypes["order_by"] | undefined,
	max?: ModelTypes["guildmanagers_max_order_by"] | undefined,
	min?: ModelTypes["guildmanagers_min_order_by"] | undefined,
	stddev?: ModelTypes["guildmanagers_stddev_order_by"] | undefined,
	stddev_pop?: ModelTypes["guildmanagers_stddev_pop_order_by"] | undefined,
	stddev_samp?: ModelTypes["guildmanagers_stddev_samp_order_by"] | undefined,
	sum?: ModelTypes["guildmanagers_sum_order_by"] | undefined,
	var_pop?: ModelTypes["guildmanagers_var_pop_order_by"] | undefined,
	var_samp?: ModelTypes["guildmanagers_var_samp_order_by"] | undefined,
	variance?: ModelTypes["guildmanagers_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "guildmanagers" */
["guildmanagers_arr_rel_insert_input"]: {
	data: Array<ModelTypes["guildmanagers_insert_input"]>,
	/** upsert condition */
	on_conflict?: ModelTypes["guildmanagers_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["guildmanagers_avg_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by avg() on columns of table "guildmanagers" */
["guildmanagers_avg_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "guildmanagers". All fields are combined with a logical 'AND'. */
["guildmanagers_bool_exp"]: {
	_and?: Array<ModelTypes["guildmanagers_bool_exp"]> | undefined,
	_not?: ModelTypes["guildmanagers_bool_exp"] | undefined,
	_or?: Array<ModelTypes["guildmanagers_bool_exp"]> | undefined,
	guild_id?: ModelTypes["Int_comparison_exp"] | undefined,
	manager_id?: ModelTypes["Int_comparison_exp"] | undefined,
	role?: ModelTypes["guildmanagerrole_comparison_exp"] | undefined,
	user?: ModelTypes["users_bool_exp"] | undefined,
	user_id?: ModelTypes["Int_comparison_exp"] | undefined
};
	["guildmanagers_constraint"]:guildmanagers_constraint;
	/** input type for incrementing numeric columns in table "guildmanagers" */
["guildmanagers_inc_input"]: {
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "guildmanagers" */
["guildmanagers_insert_input"]: {
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	role?: ModelTypes["guildmanagerrole"] | undefined,
	user?: ModelTypes["users_obj_rel_insert_input"] | undefined,
	user_id?: number | undefined
};
	/** aggregate max on columns */
["guildmanagers_max_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	role?: ModelTypes["guildmanagerrole"] | undefined,
	user_id?: number | undefined
};
	/** order by max() on columns of table "guildmanagers" */
["guildmanagers_max_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["guildmanagers_min_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	role?: ModelTypes["guildmanagerrole"] | undefined,
	user_id?: number | undefined
};
	/** order by min() on columns of table "guildmanagers" */
["guildmanagers_min_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** response of any mutation on the table "guildmanagers" */
["guildmanagers_mutation_response"]: {
		/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<ModelTypes["guildmanagers"]>
};
	/** on_conflict condition type for table "guildmanagers" */
["guildmanagers_on_conflict"]: {
	constraint: ModelTypes["guildmanagers_constraint"],
	update_columns: Array<ModelTypes["guildmanagers_update_column"]>,
	where?: ModelTypes["guildmanagers_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "guildmanagers". */
["guildmanagers_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	user?: ModelTypes["users_order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** primary key columns input for table: guildmanagers */
["guildmanagers_pk_columns_input"]: {
	manager_id: number
};
	["guildmanagers_select_column"]:guildmanagers_select_column;
	/** input type for updating data in table "guildmanagers" */
["guildmanagers_set_input"]: {
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	role?: ModelTypes["guildmanagerrole"] | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev on columns */
["guildmanagers_stddev_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev() on columns of table "guildmanagers" */
["guildmanagers_stddev_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["guildmanagers_stddev_pop_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "guildmanagers" */
["guildmanagers_stddev_pop_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["guildmanagers_stddev_samp_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "guildmanagers" */
["guildmanagers_stddev_samp_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["guildmanagers_sum_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by sum() on columns of table "guildmanagers" */
["guildmanagers_sum_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	["guildmanagers_update_column"]:guildmanagers_update_column;
	/** aggregate var_pop on columns */
["guildmanagers_var_pop_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_pop() on columns of table "guildmanagers" */
["guildmanagers_var_pop_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["guildmanagers_var_samp_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_samp() on columns of table "guildmanagers" */
["guildmanagers_var_samp_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["guildmanagers_variance_fields"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by variance() on columns of table "guildmanagers" */
["guildmanagers_variance_order_by"]: {
	guild_id?: ModelTypes["order_by"] | undefined,
	manager_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** columns and relationships of "guildmembers" */
["guildmembers"]: {
		avatar?: string | undefined,
	guild_id: number,
	member_id: number,
	nickname?: string | undefined,
	user_id: number
};
	/** aggregated selection of "guildmembers" */
["guildmembers_aggregate"]: {
		aggregate?: ModelTypes["guildmembers_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["guildmembers"]>
};
	/** aggregate fields of "guildmembers" */
["guildmembers_aggregate_fields"]: {
		avg?: ModelTypes["guildmembers_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["guildmembers_max_fields"] | undefined,
	min?: ModelTypes["guildmembers_min_fields"] | undefined,
	stddev?: ModelTypes["guildmembers_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["guildmembers_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["guildmembers_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["guildmembers_sum_fields"] | undefined,
	var_pop?: ModelTypes["guildmembers_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["guildmembers_var_samp_fields"] | undefined,
	variance?: ModelTypes["guildmembers_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["guildmembers_avg_fields"]: {
		guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "guildmembers". All fields are combined with a logical 'AND'. */
["guildmembers_bool_exp"]: {
	_and?: Array<ModelTypes["guildmembers_bool_exp"]> | undefined,
	_not?: ModelTypes["guildmembers_bool_exp"] | undefined,
	_or?: Array<ModelTypes["guildmembers_bool_exp"]> | undefined,
	avatar?: ModelTypes["String_comparison_exp"] | undefined,
	guild_id?: ModelTypes["Int_comparison_exp"] | undefined,
	member_id?: ModelTypes["Int_comparison_exp"] | undefined,
	nickname?: ModelTypes["String_comparison_exp"] | undefined,
	user_id?: ModelTypes["Int_comparison_exp"] | undefined
};
	["guildmembers_constraint"]:guildmembers_constraint;
	/** input type for incrementing numeric columns in table "guildmembers" */
["guildmembers_inc_input"]: {
	guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "guildmembers" */
["guildmembers_insert_input"]: {
	avatar?: string | undefined,
	guild_id?: number | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	user_id?: number | undefined
};
	/** aggregate max on columns */
["guildmembers_max_fields"]: {
		avatar?: string | undefined,
	guild_id?: number | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	user_id?: number | undefined
};
	/** aggregate min on columns */
["guildmembers_min_fields"]: {
		avatar?: string | undefined,
	guild_id?: number | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	user_id?: number | undefined
};
	/** response of any mutation on the table "guildmembers" */
["guildmembers_mutation_response"]: {
		/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<ModelTypes["guildmembers"]>
};
	/** on_conflict condition type for table "guildmembers" */
["guildmembers_on_conflict"]: {
	constraint: ModelTypes["guildmembers_constraint"],
	update_columns: Array<ModelTypes["guildmembers_update_column"]>,
	where?: ModelTypes["guildmembers_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "guildmembers". */
["guildmembers_order_by"]: {
	avatar?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	member_id?: ModelTypes["order_by"] | undefined,
	nickname?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** primary key columns input for table: guildmembers */
["guildmembers_pk_columns_input"]: {
	member_id: number
};
	["guildmembers_select_column"]:guildmembers_select_column;
	/** input type for updating data in table "guildmembers" */
["guildmembers_set_input"]: {
	avatar?: string | undefined,
	guild_id?: number | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev on columns */
["guildmembers_stddev_fields"]: {
		guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["guildmembers_stddev_pop_fields"]: {
		guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["guildmembers_stddev_samp_fields"]: {
		guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["guildmembers_sum_fields"]: {
		guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	["guildmembers_update_column"]:guildmembers_update_column;
	/** aggregate var_pop on columns */
["guildmembers_var_pop_fields"]: {
		guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["guildmembers_var_samp_fields"]: {
		guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["guildmembers_variance_fields"]: {
		guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** columns and relationships of "guilds" */
["guilds"]: {
		alias: string,
	created_at: ModelTypes["timestamptz"],
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id: number,
	icon?: string | undefined,
	manager_role?: ModelTypes["bigint"] | undefined,
	/** An array relationship */
	managers: Array<ModelTypes["guildmanagers"]>,
	/** An aggregate relationship */
	managers_aggregate: ModelTypes["guildmanagers_aggregate"],
	moderator_role?: ModelTypes["bigint"] | undefined,
	name: string,
	preferred_locale: string,
	snowflake: ModelTypes["bigint"],
	/** An array relationship */
	teams: Array<ModelTypes["teams"]>,
	/** An aggregate relationship */
	teams_aggregate: ModelTypes["teams_aggregate"],
	updated_at: ModelTypes["timestamptz"]
};
	/** aggregated selection of "guilds" */
["guilds_aggregate"]: {
		aggregate?: ModelTypes["guilds_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["guilds"]>
};
	/** aggregate fields of "guilds" */
["guilds_aggregate_fields"]: {
		avg?: ModelTypes["guilds_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["guilds_max_fields"] | undefined,
	min?: ModelTypes["guilds_min_fields"] | undefined,
	stddev?: ModelTypes["guilds_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["guilds_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["guilds_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["guilds_sum_fields"] | undefined,
	var_pop?: ModelTypes["guilds_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["guilds_var_samp_fields"] | undefined,
	variance?: ModelTypes["guilds_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["guilds_avg_fields"]: {
		guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** Boolean expression to filter rows from the table "guilds". All fields are combined with a logical 'AND'. */
["guilds_bool_exp"]: {
	_and?: Array<ModelTypes["guilds_bool_exp"]> | undefined,
	_not?: ModelTypes["guilds_bool_exp"] | undefined,
	_or?: Array<ModelTypes["guilds_bool_exp"]> | undefined,
	alias?: ModelTypes["String_comparison_exp"] | undefined,
	created_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	deleted_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	description?: ModelTypes["String_comparison_exp"] | undefined,
	guild_id?: ModelTypes["Int_comparison_exp"] | undefined,
	icon?: ModelTypes["String_comparison_exp"] | undefined,
	manager_role?: ModelTypes["bigint_comparison_exp"] | undefined,
	managers?: ModelTypes["guildmanagers_bool_exp"] | undefined,
	moderator_role?: ModelTypes["bigint_comparison_exp"] | undefined,
	name?: ModelTypes["String_comparison_exp"] | undefined,
	preferred_locale?: ModelTypes["String_comparison_exp"] | undefined,
	snowflake?: ModelTypes["bigint_comparison_exp"] | undefined,
	teams?: ModelTypes["teams_bool_exp"] | undefined,
	updated_at?: ModelTypes["timestamptz_comparison_exp"] | undefined
};
	["guilds_constraint"]:guilds_constraint;
	/** input type for incrementing numeric columns in table "guilds" */
["guilds_inc_input"]: {
	guild_id?: number | undefined,
	manager_role?: ModelTypes["bigint"] | undefined,
	moderator_role?: ModelTypes["bigint"] | undefined,
	snowflake?: ModelTypes["bigint"] | undefined
};
	/** input type for inserting data into table "guilds" */
["guilds_insert_input"]: {
	alias?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	manager_role?: ModelTypes["bigint"] | undefined,
	managers?: ModelTypes["guildmanagers_arr_rel_insert_input"] | undefined,
	moderator_role?: ModelTypes["bigint"] | undefined,
	name?: string | undefined,
	preferred_locale?: string | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	teams?: ModelTypes["teams_arr_rel_insert_input"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined
};
	/** aggregate max on columns */
["guilds_max_fields"]: {
		alias?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	manager_role?: ModelTypes["bigint"] | undefined,
	moderator_role?: ModelTypes["bigint"] | undefined,
	name?: string | undefined,
	preferred_locale?: string | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined
};
	/** aggregate min on columns */
["guilds_min_fields"]: {
		alias?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	manager_role?: ModelTypes["bigint"] | undefined,
	moderator_role?: ModelTypes["bigint"] | undefined,
	name?: string | undefined,
	preferred_locale?: string | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined
};
	/** response of any mutation on the table "guilds" */
["guilds_mutation_response"]: {
		/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<ModelTypes["guilds"]>
};
	/** on_conflict condition type for table "guilds" */
["guilds_on_conflict"]: {
	constraint: ModelTypes["guilds_constraint"],
	update_columns: Array<ModelTypes["guilds_update_column"]>,
	where?: ModelTypes["guilds_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "guilds". */
["guilds_order_by"]: {
	alias?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	deleted_at?: ModelTypes["order_by"] | undefined,
	description?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	icon?: ModelTypes["order_by"] | undefined,
	manager_role?: ModelTypes["order_by"] | undefined,
	managers_aggregate?: ModelTypes["guildmanagers_aggregate_order_by"] | undefined,
	moderator_role?: ModelTypes["order_by"] | undefined,
	name?: ModelTypes["order_by"] | undefined,
	preferred_locale?: ModelTypes["order_by"] | undefined,
	snowflake?: ModelTypes["order_by"] | undefined,
	teams_aggregate?: ModelTypes["teams_aggregate_order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined
};
	/** primary key columns input for table: guilds */
["guilds_pk_columns_input"]: {
	guild_id: number
};
	["guilds_select_column"]:guilds_select_column;
	/** input type for updating data in table "guilds" */
["guilds_set_input"]: {
	alias?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	manager_role?: ModelTypes["bigint"] | undefined,
	moderator_role?: ModelTypes["bigint"] | undefined,
	name?: string | undefined,
	preferred_locale?: string | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined
};
	/** aggregate stddev on columns */
["guilds_stddev_fields"]: {
		guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate stddev_pop on columns */
["guilds_stddev_pop_fields"]: {
		guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate stddev_samp on columns */
["guilds_stddev_samp_fields"]: {
		guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate sum on columns */
["guilds_sum_fields"]: {
		guild_id?: number | undefined,
	manager_role?: ModelTypes["bigint"] | undefined,
	moderator_role?: ModelTypes["bigint"] | undefined,
	snowflake?: ModelTypes["bigint"] | undefined
};
	["guilds_update_column"]:guilds_update_column;
	/** aggregate var_pop on columns */
["guilds_var_pop_fields"]: {
		guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate var_samp on columns */
["guilds_var_samp_fields"]: {
		guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate variance on columns */
["guilds_variance_fields"]: {
		guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** columns and relationships of "guildwars2accounts" */
["guildwars2accounts"]: {
		account_id: number,
	api_key?: string | undefined,
	created_at: ModelTypes["timestamptz"],
	main: boolean,
	updated_at: ModelTypes["timestamptz"],
	user_id: number,
	verified: boolean
};
	/** aggregated selection of "guildwars2accounts" */
["guildwars2accounts_aggregate"]: {
		aggregate?: ModelTypes["guildwars2accounts_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["guildwars2accounts"]>
};
	/** aggregate fields of "guildwars2accounts" */
["guildwars2accounts_aggregate_fields"]: {
		avg?: ModelTypes["guildwars2accounts_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["guildwars2accounts_max_fields"] | undefined,
	min?: ModelTypes["guildwars2accounts_min_fields"] | undefined,
	stddev?: ModelTypes["guildwars2accounts_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["guildwars2accounts_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["guildwars2accounts_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["guildwars2accounts_sum_fields"] | undefined,
	var_pop?: ModelTypes["guildwars2accounts_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["guildwars2accounts_var_samp_fields"] | undefined,
	variance?: ModelTypes["guildwars2accounts_variance_fields"] | undefined
};
	/** order by aggregate values of table "guildwars2accounts" */
["guildwars2accounts_aggregate_order_by"]: {
	avg?: ModelTypes["guildwars2accounts_avg_order_by"] | undefined,
	count?: ModelTypes["order_by"] | undefined,
	max?: ModelTypes["guildwars2accounts_max_order_by"] | undefined,
	min?: ModelTypes["guildwars2accounts_min_order_by"] | undefined,
	stddev?: ModelTypes["guildwars2accounts_stddev_order_by"] | undefined,
	stddev_pop?: ModelTypes["guildwars2accounts_stddev_pop_order_by"] | undefined,
	stddev_samp?: ModelTypes["guildwars2accounts_stddev_samp_order_by"] | undefined,
	sum?: ModelTypes["guildwars2accounts_sum_order_by"] | undefined,
	var_pop?: ModelTypes["guildwars2accounts_var_pop_order_by"] | undefined,
	var_samp?: ModelTypes["guildwars2accounts_var_samp_order_by"] | undefined,
	variance?: ModelTypes["guildwars2accounts_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "guildwars2accounts" */
["guildwars2accounts_arr_rel_insert_input"]: {
	data: Array<ModelTypes["guildwars2accounts_insert_input"]>,
	/** upsert condition */
	on_conflict?: ModelTypes["guildwars2accounts_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["guildwars2accounts_avg_fields"]: {
		account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by avg() on columns of table "guildwars2accounts" */
["guildwars2accounts_avg_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "guildwars2accounts". All fields are combined with a logical 'AND'. */
["guildwars2accounts_bool_exp"]: {
	_and?: Array<ModelTypes["guildwars2accounts_bool_exp"]> | undefined,
	_not?: ModelTypes["guildwars2accounts_bool_exp"] | undefined,
	_or?: Array<ModelTypes["guildwars2accounts_bool_exp"]> | undefined,
	account_id?: ModelTypes["Int_comparison_exp"] | undefined,
	api_key?: ModelTypes["String_comparison_exp"] | undefined,
	created_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	main?: ModelTypes["Boolean_comparison_exp"] | undefined,
	updated_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	user_id?: ModelTypes["Int_comparison_exp"] | undefined,
	verified?: ModelTypes["Boolean_comparison_exp"] | undefined
};
	["guildwars2accounts_constraint"]:guildwars2accounts_constraint;
	/** input type for incrementing numeric columns in table "guildwars2accounts" */
["guildwars2accounts_inc_input"]: {
	account_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "guildwars2accounts" */
["guildwars2accounts_insert_input"]: {
	account_id?: number | undefined,
	api_key?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	main?: boolean | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	verified?: boolean | undefined
};
	/** aggregate max on columns */
["guildwars2accounts_max_fields"]: {
		account_id?: number | undefined,
	api_key?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** order by max() on columns of table "guildwars2accounts" */
["guildwars2accounts_max_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	api_key?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["guildwars2accounts_min_fields"]: {
		account_id?: number | undefined,
	api_key?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** order by min() on columns of table "guildwars2accounts" */
["guildwars2accounts_min_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	api_key?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** response of any mutation on the table "guildwars2accounts" */
["guildwars2accounts_mutation_response"]: {
		/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<ModelTypes["guildwars2accounts"]>
};
	/** on_conflict condition type for table "guildwars2accounts" */
["guildwars2accounts_on_conflict"]: {
	constraint: ModelTypes["guildwars2accounts_constraint"],
	update_columns: Array<ModelTypes["guildwars2accounts_update_column"]>,
	where?: ModelTypes["guildwars2accounts_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "guildwars2accounts". */
["guildwars2accounts_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	api_key?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	main?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined,
	verified?: ModelTypes["order_by"] | undefined
};
	/** primary key columns input for table: guildwars2accounts */
["guildwars2accounts_pk_columns_input"]: {
	account_id: number
};
	["guildwars2accounts_select_column"]:guildwars2accounts_select_column;
	/** input type for updating data in table "guildwars2accounts" */
["guildwars2accounts_set_input"]: {
	account_id?: number | undefined,
	api_key?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	main?: boolean | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	verified?: boolean | undefined
};
	/** aggregate stddev on columns */
["guildwars2accounts_stddev_fields"]: {
		account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["guildwars2accounts_stddev_pop_fields"]: {
		account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_pop_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["guildwars2accounts_stddev_samp_fields"]: {
		account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_samp_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["guildwars2accounts_sum_fields"]: {
		account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by sum() on columns of table "guildwars2accounts" */
["guildwars2accounts_sum_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	["guildwars2accounts_update_column"]:guildwars2accounts_update_column;
	/** aggregate var_pop on columns */
["guildwars2accounts_var_pop_fields"]: {
		account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_pop() on columns of table "guildwars2accounts" */
["guildwars2accounts_var_pop_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["guildwars2accounts_var_samp_fields"]: {
		account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_samp() on columns of table "guildwars2accounts" */
["guildwars2accounts_var_samp_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["guildwars2accounts_variance_fields"]: {
		account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by variance() on columns of table "guildwars2accounts" */
["guildwars2accounts_variance_order_by"]: {
	account_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** mutation root */
["mutation_root"]: {
		/** delete data from the table: "guildmanagers" */
	delete_guildmanagers?: ModelTypes["guildmanagers_mutation_response"] | undefined,
	/** delete single row from the table: "guildmanagers" */
	delete_guildmanagers_by_pk?: ModelTypes["guildmanagers"] | undefined,
	/** delete data from the table: "guildmembers" */
	delete_guildmembers?: ModelTypes["guildmembers_mutation_response"] | undefined,
	/** delete single row from the table: "guildmembers" */
	delete_guildmembers_by_pk?: ModelTypes["guildmembers"] | undefined,
	/** delete data from the table: "guilds" */
	delete_guilds?: ModelTypes["guilds_mutation_response"] | undefined,
	/** delete single row from the table: "guilds" */
	delete_guilds_by_pk?: ModelTypes["guilds"] | undefined,
	/** delete data from the table: "guildwars2accounts" */
	delete_guildwars2accounts?: ModelTypes["guildwars2accounts_mutation_response"] | undefined,
	/** delete single row from the table: "guildwars2accounts" */
	delete_guildwars2accounts_by_pk?: ModelTypes["guildwars2accounts"] | undefined,
	/** delete data from the table: "profiles" */
	delete_profiles?: ModelTypes["profiles_mutation_response"] | undefined,
	/** delete single row from the table: "profiles" */
	delete_profiles_by_pk?: ModelTypes["profiles"] | undefined,
	/** delete data from the table: "teammembers" */
	delete_teammembers?: ModelTypes["teammembers_mutation_response"] | undefined,
	/** delete single row from the table: "teammembers" */
	delete_teammembers_by_pk?: ModelTypes["teammembers"] | undefined,
	/** delete data from the table: "teams" */
	delete_teams?: ModelTypes["teams_mutation_response"] | undefined,
	/** delete single row from the table: "teams" */
	delete_teams_by_pk?: ModelTypes["teams"] | undefined,
	/** delete data from the table: "teamtimes" */
	delete_teamtimes?: ModelTypes["teamtimes_mutation_response"] | undefined,
	/** delete single row from the table: "teamtimes" */
	delete_teamtimes_by_pk?: ModelTypes["teamtimes"] | undefined,
	/** delete data from the table: "users" */
	delete_users?: ModelTypes["users_mutation_response"] | undefined,
	/** delete single row from the table: "users" */
	delete_users_by_pk?: ModelTypes["users"] | undefined,
	/** insert data into the table: "guildmanagers" */
	insert_guildmanagers?: ModelTypes["guildmanagers_mutation_response"] | undefined,
	/** insert a single row into the table: "guildmanagers" */
	insert_guildmanagers_one?: ModelTypes["guildmanagers"] | undefined,
	/** insert data into the table: "guildmembers" */
	insert_guildmembers?: ModelTypes["guildmembers_mutation_response"] | undefined,
	/** insert a single row into the table: "guildmembers" */
	insert_guildmembers_one?: ModelTypes["guildmembers"] | undefined,
	/** insert data into the table: "guilds" */
	insert_guilds?: ModelTypes["guilds_mutation_response"] | undefined,
	/** insert a single row into the table: "guilds" */
	insert_guilds_one?: ModelTypes["guilds"] | undefined,
	/** insert data into the table: "guildwars2accounts" */
	insert_guildwars2accounts?: ModelTypes["guildwars2accounts_mutation_response"] | undefined,
	/** insert a single row into the table: "guildwars2accounts" */
	insert_guildwars2accounts_one?: ModelTypes["guildwars2accounts"] | undefined,
	/** insert data into the table: "profiles" */
	insert_profiles?: ModelTypes["profiles_mutation_response"] | undefined,
	/** insert a single row into the table: "profiles" */
	insert_profiles_one?: ModelTypes["profiles"] | undefined,
	/** insert data into the table: "teammembers" */
	insert_teammembers?: ModelTypes["teammembers_mutation_response"] | undefined,
	/** insert a single row into the table: "teammembers" */
	insert_teammembers_one?: ModelTypes["teammembers"] | undefined,
	/** insert data into the table: "teams" */
	insert_teams?: ModelTypes["teams_mutation_response"] | undefined,
	/** insert a single row into the table: "teams" */
	insert_teams_one?: ModelTypes["teams"] | undefined,
	/** insert data into the table: "teamtimes" */
	insert_teamtimes?: ModelTypes["teamtimes_mutation_response"] | undefined,
	/** insert a single row into the table: "teamtimes" */
	insert_teamtimes_one?: ModelTypes["teamtimes"] | undefined,
	/** insert data into the table: "users" */
	insert_users?: ModelTypes["users_mutation_response"] | undefined,
	/** insert a single row into the table: "users" */
	insert_users_one?: ModelTypes["users"] | undefined,
	/** update data of the table: "guildmanagers" */
	update_guildmanagers?: ModelTypes["guildmanagers_mutation_response"] | undefined,
	/** update single row of the table: "guildmanagers" */
	update_guildmanagers_by_pk?: ModelTypes["guildmanagers"] | undefined,
	/** update data of the table: "guildmembers" */
	update_guildmembers?: ModelTypes["guildmembers_mutation_response"] | undefined,
	/** update single row of the table: "guildmembers" */
	update_guildmembers_by_pk?: ModelTypes["guildmembers"] | undefined,
	/** update data of the table: "guilds" */
	update_guilds?: ModelTypes["guilds_mutation_response"] | undefined,
	/** update single row of the table: "guilds" */
	update_guilds_by_pk?: ModelTypes["guilds"] | undefined,
	/** update data of the table: "guildwars2accounts" */
	update_guildwars2accounts?: ModelTypes["guildwars2accounts_mutation_response"] | undefined,
	/** update single row of the table: "guildwars2accounts" */
	update_guildwars2accounts_by_pk?: ModelTypes["guildwars2accounts"] | undefined,
	/** update data of the table: "profiles" */
	update_profiles?: ModelTypes["profiles_mutation_response"] | undefined,
	/** update single row of the table: "profiles" */
	update_profiles_by_pk?: ModelTypes["profiles"] | undefined,
	/** update data of the table: "teammembers" */
	update_teammembers?: ModelTypes["teammembers_mutation_response"] | undefined,
	/** update single row of the table: "teammembers" */
	update_teammembers_by_pk?: ModelTypes["teammembers"] | undefined,
	/** update data of the table: "teams" */
	update_teams?: ModelTypes["teams_mutation_response"] | undefined,
	/** update single row of the table: "teams" */
	update_teams_by_pk?: ModelTypes["teams"] | undefined,
	/** update data of the table: "teamtimes" */
	update_teamtimes?: ModelTypes["teamtimes_mutation_response"] | undefined,
	/** update single row of the table: "teamtimes" */
	update_teamtimes_by_pk?: ModelTypes["teamtimes"] | undefined,
	/** update data of the table: "users" */
	update_users?: ModelTypes["users_mutation_response"] | undefined,
	/** update single row of the table: "users" */
	update_users_by_pk?: ModelTypes["users"] | undefined
};
	["order_by"]:order_by;
	/** columns and relationships of "profiles" */
["profiles"]: {
		avatar: string,
	created_at: ModelTypes["timestamptz"],
	profile_id: number,
	updated_at: ModelTypes["timestamptz"],
	/** An object relationship */
	user: ModelTypes["users"],
	user_id: number
};
	/** aggregated selection of "profiles" */
["profiles_aggregate"]: {
		aggregate?: ModelTypes["profiles_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["profiles"]>
};
	/** aggregate fields of "profiles" */
["profiles_aggregate_fields"]: {
		avg?: ModelTypes["profiles_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["profiles_max_fields"] | undefined,
	min?: ModelTypes["profiles_min_fields"] | undefined,
	stddev?: ModelTypes["profiles_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["profiles_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["profiles_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["profiles_sum_fields"] | undefined,
	var_pop?: ModelTypes["profiles_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["profiles_var_samp_fields"] | undefined,
	variance?: ModelTypes["profiles_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["profiles_avg_fields"]: {
		profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "profiles". All fields are combined with a logical 'AND'. */
["profiles_bool_exp"]: {
	_and?: Array<ModelTypes["profiles_bool_exp"]> | undefined,
	_not?: ModelTypes["profiles_bool_exp"] | undefined,
	_or?: Array<ModelTypes["profiles_bool_exp"]> | undefined,
	avatar?: ModelTypes["String_comparison_exp"] | undefined,
	created_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	profile_id?: ModelTypes["Int_comparison_exp"] | undefined,
	updated_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	user?: ModelTypes["users_bool_exp"] | undefined,
	user_id?: ModelTypes["Int_comparison_exp"] | undefined
};
	["profiles_constraint"]:profiles_constraint;
	/** input type for incrementing numeric columns in table "profiles" */
["profiles_inc_input"]: {
	profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "profiles" */
["profiles_insert_input"]: {
	avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	profile_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user?: ModelTypes["users_obj_rel_insert_input"] | undefined,
	user_id?: number | undefined
};
	/** aggregate max on columns */
["profiles_max_fields"]: {
		avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	profile_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** aggregate min on columns */
["profiles_min_fields"]: {
		avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	profile_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** response of any mutation on the table "profiles" */
["profiles_mutation_response"]: {
		/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<ModelTypes["profiles"]>
};
	/** on_conflict condition type for table "profiles" */
["profiles_on_conflict"]: {
	constraint: ModelTypes["profiles_constraint"],
	update_columns: Array<ModelTypes["profiles_update_column"]>,
	where?: ModelTypes["profiles_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "profiles". */
["profiles_order_by"]: {
	avatar?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	profile_id?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined,
	user?: ModelTypes["users_order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** primary key columns input for table: profiles */
["profiles_pk_columns_input"]: {
	profile_id: number
};
	["profiles_select_column"]:profiles_select_column;
	/** input type for updating data in table "profiles" */
["profiles_set_input"]: {
	avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	profile_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev on columns */
["profiles_stddev_fields"]: {
		profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["profiles_stddev_pop_fields"]: {
		profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["profiles_stddev_samp_fields"]: {
		profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["profiles_sum_fields"]: {
		profile_id?: number | undefined,
	user_id?: number | undefined
};
	["profiles_update_column"]:profiles_update_column;
	/** aggregate var_pop on columns */
["profiles_var_pop_fields"]: {
		profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["profiles_var_samp_fields"]: {
		profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["profiles_variance_fields"]: {
		profile_id?: number | undefined,
	user_id?: number | undefined
};
	["query_root"]: {
		/** fetch data from the table: "guildmanagers" */
	guildmanagers: Array<ModelTypes["guildmanagers"]>,
	/** fetch aggregated fields from the table: "guildmanagers" */
	guildmanagers_aggregate: ModelTypes["guildmanagers_aggregate"],
	/** fetch data from the table: "guildmanagers" using primary key columns */
	guildmanagers_by_pk?: ModelTypes["guildmanagers"] | undefined,
	/** fetch data from the table: "guildmembers" */
	guildmembers: Array<ModelTypes["guildmembers"]>,
	/** fetch aggregated fields from the table: "guildmembers" */
	guildmembers_aggregate: ModelTypes["guildmembers_aggregate"],
	/** fetch data from the table: "guildmembers" using primary key columns */
	guildmembers_by_pk?: ModelTypes["guildmembers"] | undefined,
	/** fetch data from the table: "guilds" */
	guilds: Array<ModelTypes["guilds"]>,
	/** fetch aggregated fields from the table: "guilds" */
	guilds_aggregate: ModelTypes["guilds_aggregate"],
	/** fetch data from the table: "guilds" using primary key columns */
	guilds_by_pk?: ModelTypes["guilds"] | undefined,
	/** fetch data from the table: "guildwars2accounts" */
	guildwars2accounts: Array<ModelTypes["guildwars2accounts"]>,
	/** fetch aggregated fields from the table: "guildwars2accounts" */
	guildwars2accounts_aggregate: ModelTypes["guildwars2accounts_aggregate"],
	/** fetch data from the table: "guildwars2accounts" using primary key columns */
	guildwars2accounts_by_pk?: ModelTypes["guildwars2accounts"] | undefined,
	/** fetch data from the table: "profiles" */
	profiles: Array<ModelTypes["profiles"]>,
	/** fetch aggregated fields from the table: "profiles" */
	profiles_aggregate: ModelTypes["profiles_aggregate"],
	/** fetch data from the table: "profiles" using primary key columns */
	profiles_by_pk?: ModelTypes["profiles"] | undefined,
	/** fetch data from the table: "teammembers" */
	teammembers: Array<ModelTypes["teammembers"]>,
	/** fetch aggregated fields from the table: "teammembers" */
	teammembers_aggregate: ModelTypes["teammembers_aggregate"],
	/** fetch data from the table: "teammembers" using primary key columns */
	teammembers_by_pk?: ModelTypes["teammembers"] | undefined,
	/** An array relationship */
	teams: Array<ModelTypes["teams"]>,
	/** An aggregate relationship */
	teams_aggregate: ModelTypes["teams_aggregate"],
	/** fetch data from the table: "teams" using primary key columns */
	teams_by_pk?: ModelTypes["teams"] | undefined,
	/** fetch data from the table: "teamtimes" */
	teamtimes: Array<ModelTypes["teamtimes"]>,
	/** fetch aggregated fields from the table: "teamtimes" */
	teamtimes_aggregate: ModelTypes["teamtimes_aggregate"],
	/** fetch data from the table: "teamtimes" using primary key columns */
	teamtimes_by_pk?: ModelTypes["teamtimes"] | undefined,
	/** fetch data from the table: "usermemberships" */
	usermemberships: Array<ModelTypes["usermemberships"]>,
	/** fetch aggregated fields from the table: "usermemberships" */
	usermemberships_aggregate: ModelTypes["usermemberships_aggregate"],
	/** fetch data from the table: "userprofiles" */
	userprofiles: Array<ModelTypes["userprofiles"]>,
	/** fetch aggregated fields from the table: "userprofiles" */
	userprofiles_aggregate: ModelTypes["userprofiles_aggregate"],
	/** fetch data from the table: "users" */
	users: Array<ModelTypes["users"]>,
	/** fetch aggregated fields from the table: "users" */
	users_aggregate: ModelTypes["users_aggregate"],
	/** fetch data from the table: "users" using primary key columns */
	users_by_pk?: ModelTypes["users"] | undefined
};
	["smallint"]:any;
	/** Boolean expression to compare columns of type "smallint". All fields are combined with logical 'AND'. */
["smallint_comparison_exp"]: {
	_eq?: ModelTypes["smallint"] | undefined,
	_gt?: ModelTypes["smallint"] | undefined,
	_gte?: ModelTypes["smallint"] | undefined,
	_in?: Array<ModelTypes["smallint"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: ModelTypes["smallint"] | undefined,
	_lte?: ModelTypes["smallint"] | undefined,
	_neq?: ModelTypes["smallint"] | undefined,
	_nin?: Array<ModelTypes["smallint"]> | undefined
};
	["subscription_root"]: {
		/** fetch data from the table: "guildmanagers" */
	guildmanagers: Array<ModelTypes["guildmanagers"]>,
	/** fetch aggregated fields from the table: "guildmanagers" */
	guildmanagers_aggregate: ModelTypes["guildmanagers_aggregate"],
	/** fetch data from the table: "guildmanagers" using primary key columns */
	guildmanagers_by_pk?: ModelTypes["guildmanagers"] | undefined,
	/** fetch data from the table: "guildmembers" */
	guildmembers: Array<ModelTypes["guildmembers"]>,
	/** fetch aggregated fields from the table: "guildmembers" */
	guildmembers_aggregate: ModelTypes["guildmembers_aggregate"],
	/** fetch data from the table: "guildmembers" using primary key columns */
	guildmembers_by_pk?: ModelTypes["guildmembers"] | undefined,
	/** fetch data from the table: "guilds" */
	guilds: Array<ModelTypes["guilds"]>,
	/** fetch aggregated fields from the table: "guilds" */
	guilds_aggregate: ModelTypes["guilds_aggregate"],
	/** fetch data from the table: "guilds" using primary key columns */
	guilds_by_pk?: ModelTypes["guilds"] | undefined,
	/** fetch data from the table: "guildwars2accounts" */
	guildwars2accounts: Array<ModelTypes["guildwars2accounts"]>,
	/** fetch aggregated fields from the table: "guildwars2accounts" */
	guildwars2accounts_aggregate: ModelTypes["guildwars2accounts_aggregate"],
	/** fetch data from the table: "guildwars2accounts" using primary key columns */
	guildwars2accounts_by_pk?: ModelTypes["guildwars2accounts"] | undefined,
	/** fetch data from the table: "profiles" */
	profiles: Array<ModelTypes["profiles"]>,
	/** fetch aggregated fields from the table: "profiles" */
	profiles_aggregate: ModelTypes["profiles_aggregate"],
	/** fetch data from the table: "profiles" using primary key columns */
	profiles_by_pk?: ModelTypes["profiles"] | undefined,
	/** fetch data from the table: "teammembers" */
	teammembers: Array<ModelTypes["teammembers"]>,
	/** fetch aggregated fields from the table: "teammembers" */
	teammembers_aggregate: ModelTypes["teammembers_aggregate"],
	/** fetch data from the table: "teammembers" using primary key columns */
	teammembers_by_pk?: ModelTypes["teammembers"] | undefined,
	/** An array relationship */
	teams: Array<ModelTypes["teams"]>,
	/** An aggregate relationship */
	teams_aggregate: ModelTypes["teams_aggregate"],
	/** fetch data from the table: "teams" using primary key columns */
	teams_by_pk?: ModelTypes["teams"] | undefined,
	/** fetch data from the table: "teamtimes" */
	teamtimes: Array<ModelTypes["teamtimes"]>,
	/** fetch aggregated fields from the table: "teamtimes" */
	teamtimes_aggregate: ModelTypes["teamtimes_aggregate"],
	/** fetch data from the table: "teamtimes" using primary key columns */
	teamtimes_by_pk?: ModelTypes["teamtimes"] | undefined,
	/** fetch data from the table: "usermemberships" */
	usermemberships: Array<ModelTypes["usermemberships"]>,
	/** fetch aggregated fields from the table: "usermemberships" */
	usermemberships_aggregate: ModelTypes["usermemberships_aggregate"],
	/** fetch data from the table: "userprofiles" */
	userprofiles: Array<ModelTypes["userprofiles"]>,
	/** fetch aggregated fields from the table: "userprofiles" */
	userprofiles_aggregate: ModelTypes["userprofiles_aggregate"],
	/** fetch data from the table: "users" */
	users: Array<ModelTypes["users"]>,
	/** fetch aggregated fields from the table: "users" */
	users_aggregate: ModelTypes["users_aggregate"],
	/** fetch data from the table: "users" using primary key columns */
	users_by_pk?: ModelTypes["users"] | undefined
};
	["teammemberrole"]:any;
	/** Boolean expression to compare columns of type "teammemberrole". All fields are combined with logical 'AND'. */
["teammemberrole_comparison_exp"]: {
	_eq?: ModelTypes["teammemberrole"] | undefined,
	_gt?: ModelTypes["teammemberrole"] | undefined,
	_gte?: ModelTypes["teammemberrole"] | undefined,
	_in?: Array<ModelTypes["teammemberrole"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: ModelTypes["teammemberrole"] | undefined,
	_lte?: ModelTypes["teammemberrole"] | undefined,
	_neq?: ModelTypes["teammemberrole"] | undefined,
	_nin?: Array<ModelTypes["teammemberrole"]> | undefined
};
	/** columns and relationships of "teammembers" */
["teammembers"]: {
		avatar?: string | undefined,
	created_at: ModelTypes["timestamptz"],
	member_id: number,
	nickname?: string | undefined,
	role: ModelTypes["teammemberrole"],
	/** An object relationship */
	team: ModelTypes["teams"],
	team_id: number,
	updated_at: ModelTypes["timestamptz"],
	/** An object relationship */
	user: ModelTypes["users"],
	user_id: number,
	visibility: ModelTypes["visibility"]
};
	/** aggregated selection of "teammembers" */
["teammembers_aggregate"]: {
		aggregate?: ModelTypes["teammembers_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["teammembers"]>
};
	/** aggregate fields of "teammembers" */
["teammembers_aggregate_fields"]: {
		avg?: ModelTypes["teammembers_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["teammembers_max_fields"] | undefined,
	min?: ModelTypes["teammembers_min_fields"] | undefined,
	stddev?: ModelTypes["teammembers_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["teammembers_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["teammembers_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["teammembers_sum_fields"] | undefined,
	var_pop?: ModelTypes["teammembers_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["teammembers_var_samp_fields"] | undefined,
	variance?: ModelTypes["teammembers_variance_fields"] | undefined
};
	/** order by aggregate values of table "teammembers" */
["teammembers_aggregate_order_by"]: {
	avg?: ModelTypes["teammembers_avg_order_by"] | undefined,
	count?: ModelTypes["order_by"] | undefined,
	max?: ModelTypes["teammembers_max_order_by"] | undefined,
	min?: ModelTypes["teammembers_min_order_by"] | undefined,
	stddev?: ModelTypes["teammembers_stddev_order_by"] | undefined,
	stddev_pop?: ModelTypes["teammembers_stddev_pop_order_by"] | undefined,
	stddev_samp?: ModelTypes["teammembers_stddev_samp_order_by"] | undefined,
	sum?: ModelTypes["teammembers_sum_order_by"] | undefined,
	var_pop?: ModelTypes["teammembers_var_pop_order_by"] | undefined,
	var_samp?: ModelTypes["teammembers_var_samp_order_by"] | undefined,
	variance?: ModelTypes["teammembers_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "teammembers" */
["teammembers_arr_rel_insert_input"]: {
	data: Array<ModelTypes["teammembers_insert_input"]>,
	/** upsert condition */
	on_conflict?: ModelTypes["teammembers_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["teammembers_avg_fields"]: {
		member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by avg() on columns of table "teammembers" */
["teammembers_avg_order_by"]: {
	member_id?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "teammembers". All fields are combined with a logical 'AND'. */
["teammembers_bool_exp"]: {
	_and?: Array<ModelTypes["teammembers_bool_exp"]> | undefined,
	_not?: ModelTypes["teammembers_bool_exp"] | undefined,
	_or?: Array<ModelTypes["teammembers_bool_exp"]> | undefined,
	avatar?: ModelTypes["String_comparison_exp"] | undefined,
	created_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	member_id?: ModelTypes["Int_comparison_exp"] | undefined,
	nickname?: ModelTypes["String_comparison_exp"] | undefined,
	role?: ModelTypes["teammemberrole_comparison_exp"] | undefined,
	team?: ModelTypes["teams_bool_exp"] | undefined,
	team_id?: ModelTypes["Int_comparison_exp"] | undefined,
	updated_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	user?: ModelTypes["users_bool_exp"] | undefined,
	user_id?: ModelTypes["Int_comparison_exp"] | undefined,
	visibility?: ModelTypes["visibility_comparison_exp"] | undefined
};
	["teammembers_constraint"]:teammembers_constraint;
	/** input type for incrementing numeric columns in table "teammembers" */
["teammembers_inc_input"]: {
	member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "teammembers" */
["teammembers_insert_input"]: {
	avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	role?: ModelTypes["teammemberrole"] | undefined,
	team?: ModelTypes["teams_obj_rel_insert_input"] | undefined,
	team_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user?: ModelTypes["users_obj_rel_insert_input"] | undefined,
	user_id?: number | undefined,
	visibility?: ModelTypes["visibility"] | undefined
};
	/** aggregate max on columns */
["teammembers_max_fields"]: {
		avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	role?: ModelTypes["teammemberrole"] | undefined,
	team_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	visibility?: ModelTypes["visibility"] | undefined
};
	/** order by max() on columns of table "teammembers" */
["teammembers_max_order_by"]: {
	avatar?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	member_id?: ModelTypes["order_by"] | undefined,
	nickname?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined,
	visibility?: ModelTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["teammembers_min_fields"]: {
		avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	role?: ModelTypes["teammemberrole"] | undefined,
	team_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	visibility?: ModelTypes["visibility"] | undefined
};
	/** order by min() on columns of table "teammembers" */
["teammembers_min_order_by"]: {
	avatar?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	member_id?: ModelTypes["order_by"] | undefined,
	nickname?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined,
	visibility?: ModelTypes["order_by"] | undefined
};
	/** response of any mutation on the table "teammembers" */
["teammembers_mutation_response"]: {
		/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<ModelTypes["teammembers"]>
};
	/** on_conflict condition type for table "teammembers" */
["teammembers_on_conflict"]: {
	constraint: ModelTypes["teammembers_constraint"],
	update_columns: Array<ModelTypes["teammembers_update_column"]>,
	where?: ModelTypes["teammembers_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "teammembers". */
["teammembers_order_by"]: {
	avatar?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	member_id?: ModelTypes["order_by"] | undefined,
	nickname?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team?: ModelTypes["teams_order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined,
	user?: ModelTypes["users_order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined,
	visibility?: ModelTypes["order_by"] | undefined
};
	/** primary key columns input for table: teammembers */
["teammembers_pk_columns_input"]: {
	member_id: number
};
	["teammembers_select_column"]:teammembers_select_column;
	/** input type for updating data in table "teammembers" */
["teammembers_set_input"]: {
	avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	role?: ModelTypes["teammemberrole"] | undefined,
	team_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	visibility?: ModelTypes["visibility"] | undefined
};
	/** aggregate stddev on columns */
["teammembers_stddev_fields"]: {
		member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev() on columns of table "teammembers" */
["teammembers_stddev_order_by"]: {
	member_id?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["teammembers_stddev_pop_fields"]: {
		member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "teammembers" */
["teammembers_stddev_pop_order_by"]: {
	member_id?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["teammembers_stddev_samp_fields"]: {
		member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "teammembers" */
["teammembers_stddev_samp_order_by"]: {
	member_id?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["teammembers_sum_fields"]: {
		member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by sum() on columns of table "teammembers" */
["teammembers_sum_order_by"]: {
	member_id?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	["teammembers_update_column"]:teammembers_update_column;
	/** aggregate var_pop on columns */
["teammembers_var_pop_fields"]: {
		member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_pop() on columns of table "teammembers" */
["teammembers_var_pop_order_by"]: {
	member_id?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["teammembers_var_samp_fields"]: {
		member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_samp() on columns of table "teammembers" */
["teammembers_var_samp_order_by"]: {
	member_id?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["teammembers_variance_fields"]: {
		member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by variance() on columns of table "teammembers" */
["teammembers_variance_order_by"]: {
	member_id?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	/** columns and relationships of "teams" */
["teams"]: {
		alias: string,
	channel?: ModelTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at: ModelTypes["timestamptz"],
	description?: string | undefined,
	guild_id: number,
	icon?: string | undefined,
	/** An array relationship */
	members: Array<ModelTypes["teammembers"]>,
	/** An aggregate relationship */
	members_aggregate: ModelTypes["teammembers_aggregate"],
	name: string,
	role?: ModelTypes["bigint"] | undefined,
	team_id: number,
	/** An array relationship */
	times: Array<ModelTypes["teamtimes"]>,
	/** An aggregate relationship */
	times_aggregate: ModelTypes["teamtimes_aggregate"],
	updated_at: ModelTypes["timestamptz"]
};
	/** aggregated selection of "teams" */
["teams_aggregate"]: {
		aggregate?: ModelTypes["teams_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["teams"]>
};
	/** aggregate fields of "teams" */
["teams_aggregate_fields"]: {
		avg?: ModelTypes["teams_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["teams_max_fields"] | undefined,
	min?: ModelTypes["teams_min_fields"] | undefined,
	stddev?: ModelTypes["teams_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["teams_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["teams_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["teams_sum_fields"] | undefined,
	var_pop?: ModelTypes["teams_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["teams_var_samp_fields"] | undefined,
	variance?: ModelTypes["teams_variance_fields"] | undefined
};
	/** order by aggregate values of table "teams" */
["teams_aggregate_order_by"]: {
	avg?: ModelTypes["teams_avg_order_by"] | undefined,
	count?: ModelTypes["order_by"] | undefined,
	max?: ModelTypes["teams_max_order_by"] | undefined,
	min?: ModelTypes["teams_min_order_by"] | undefined,
	stddev?: ModelTypes["teams_stddev_order_by"] | undefined,
	stddev_pop?: ModelTypes["teams_stddev_pop_order_by"] | undefined,
	stddev_samp?: ModelTypes["teams_stddev_samp_order_by"] | undefined,
	sum?: ModelTypes["teams_sum_order_by"] | undefined,
	var_pop?: ModelTypes["teams_var_pop_order_by"] | undefined,
	var_samp?: ModelTypes["teams_var_samp_order_by"] | undefined,
	variance?: ModelTypes["teams_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "teams" */
["teams_arr_rel_insert_input"]: {
	data: Array<ModelTypes["teams_insert_input"]>,
	/** upsert condition */
	on_conflict?: ModelTypes["teams_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["teams_avg_fields"]: {
		channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by avg() on columns of table "teams" */
["teams_avg_order_by"]: {
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "teams". All fields are combined with a logical 'AND'. */
["teams_bool_exp"]: {
	_and?: Array<ModelTypes["teams_bool_exp"]> | undefined,
	_not?: ModelTypes["teams_bool_exp"] | undefined,
	_or?: Array<ModelTypes["teams_bool_exp"]> | undefined,
	alias?: ModelTypes["String_comparison_exp"] | undefined,
	channel?: ModelTypes["bigint_comparison_exp"] | undefined,
	color?: ModelTypes["Int_comparison_exp"] | undefined,
	created_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	description?: ModelTypes["String_comparison_exp"] | undefined,
	guild_id?: ModelTypes["Int_comparison_exp"] | undefined,
	icon?: ModelTypes["String_comparison_exp"] | undefined,
	members?: ModelTypes["teammembers_bool_exp"] | undefined,
	name?: ModelTypes["String_comparison_exp"] | undefined,
	role?: ModelTypes["bigint_comparison_exp"] | undefined,
	team_id?: ModelTypes["Int_comparison_exp"] | undefined,
	times?: ModelTypes["teamtimes_bool_exp"] | undefined,
	updated_at?: ModelTypes["timestamptz_comparison_exp"] | undefined
};
	["teams_constraint"]:teams_constraint;
	/** input type for incrementing numeric columns in table "teams" */
["teams_inc_input"]: {
	channel?: ModelTypes["bigint"] | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: ModelTypes["bigint"] | undefined,
	team_id?: number | undefined
};
	/** input type for inserting data into table "teams" */
["teams_insert_input"]: {
	alias?: string | undefined,
	channel?: ModelTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	members?: ModelTypes["teammembers_arr_rel_insert_input"] | undefined,
	name?: string | undefined,
	role?: ModelTypes["bigint"] | undefined,
	team_id?: number | undefined,
	times?: ModelTypes["teamtimes_arr_rel_insert_input"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined
};
	/** aggregate max on columns */
["teams_max_fields"]: {
		alias?: string | undefined,
	channel?: ModelTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	name?: string | undefined,
	role?: ModelTypes["bigint"] | undefined,
	team_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined
};
	/** order by max() on columns of table "teams" */
["teams_max_order_by"]: {
	alias?: ModelTypes["order_by"] | undefined,
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	description?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	icon?: ModelTypes["order_by"] | undefined,
	name?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["teams_min_fields"]: {
		alias?: string | undefined,
	channel?: ModelTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	name?: string | undefined,
	role?: ModelTypes["bigint"] | undefined,
	team_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined
};
	/** order by min() on columns of table "teams" */
["teams_min_order_by"]: {
	alias?: ModelTypes["order_by"] | undefined,
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	description?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	icon?: ModelTypes["order_by"] | undefined,
	name?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined
};
	/** response of any mutation on the table "teams" */
["teams_mutation_response"]: {
		/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<ModelTypes["teams"]>
};
	/** input type for inserting object relation for remote table "teams" */
["teams_obj_rel_insert_input"]: {
	data: ModelTypes["teams_insert_input"],
	/** upsert condition */
	on_conflict?: ModelTypes["teams_on_conflict"] | undefined
};
	/** on_conflict condition type for table "teams" */
["teams_on_conflict"]: {
	constraint: ModelTypes["teams_constraint"],
	update_columns: Array<ModelTypes["teams_update_column"]>,
	where?: ModelTypes["teams_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "teams". */
["teams_order_by"]: {
	alias?: ModelTypes["order_by"] | undefined,
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	description?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	icon?: ModelTypes["order_by"] | undefined,
	members_aggregate?: ModelTypes["teammembers_aggregate_order_by"] | undefined,
	name?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	times_aggregate?: ModelTypes["teamtimes_aggregate_order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined
};
	/** primary key columns input for table: teams */
["teams_pk_columns_input"]: {
	team_id: number
};
	["teams_select_column"]:teams_select_column;
	/** input type for updating data in table "teams" */
["teams_set_input"]: {
	alias?: string | undefined,
	channel?: ModelTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	name?: string | undefined,
	role?: ModelTypes["bigint"] | undefined,
	team_id?: number | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined
};
	/** aggregate stddev on columns */
["teams_stddev_fields"]: {
		channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by stddev() on columns of table "teams" */
["teams_stddev_order_by"]: {
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["teams_stddev_pop_fields"]: {
		channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "teams" */
["teams_stddev_pop_order_by"]: {
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["teams_stddev_samp_fields"]: {
		channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "teams" */
["teams_stddev_samp_order_by"]: {
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["teams_sum_fields"]: {
		channel?: ModelTypes["bigint"] | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: ModelTypes["bigint"] | undefined,
	team_id?: number | undefined
};
	/** order by sum() on columns of table "teams" */
["teams_sum_order_by"]: {
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined
};
	["teams_update_column"]:teams_update_column;
	/** aggregate var_pop on columns */
["teams_var_pop_fields"]: {
		channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by var_pop() on columns of table "teams" */
["teams_var_pop_order_by"]: {
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["teams_var_samp_fields"]: {
		channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by var_samp() on columns of table "teams" */
["teams_var_samp_order_by"]: {
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["teams_variance_fields"]: {
		channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by variance() on columns of table "teams" */
["teams_variance_order_by"]: {
	channel?: ModelTypes["order_by"] | undefined,
	color?: ModelTypes["order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined
};
	/** columns and relationships of "teamtimes" */
["teamtimes"]: {
		duration: ModelTypes["time"],
	team_id?: number | undefined,
	time: ModelTypes["timestamptz"],
	time_id: number
};
	/** aggregated selection of "teamtimes" */
["teamtimes_aggregate"]: {
		aggregate?: ModelTypes["teamtimes_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["teamtimes"]>
};
	/** aggregate fields of "teamtimes" */
["teamtimes_aggregate_fields"]: {
		avg?: ModelTypes["teamtimes_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["teamtimes_max_fields"] | undefined,
	min?: ModelTypes["teamtimes_min_fields"] | undefined,
	stddev?: ModelTypes["teamtimes_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["teamtimes_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["teamtimes_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["teamtimes_sum_fields"] | undefined,
	var_pop?: ModelTypes["teamtimes_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["teamtimes_var_samp_fields"] | undefined,
	variance?: ModelTypes["teamtimes_variance_fields"] | undefined
};
	/** order by aggregate values of table "teamtimes" */
["teamtimes_aggregate_order_by"]: {
	avg?: ModelTypes["teamtimes_avg_order_by"] | undefined,
	count?: ModelTypes["order_by"] | undefined,
	max?: ModelTypes["teamtimes_max_order_by"] | undefined,
	min?: ModelTypes["teamtimes_min_order_by"] | undefined,
	stddev?: ModelTypes["teamtimes_stddev_order_by"] | undefined,
	stddev_pop?: ModelTypes["teamtimes_stddev_pop_order_by"] | undefined,
	stddev_samp?: ModelTypes["teamtimes_stddev_samp_order_by"] | undefined,
	sum?: ModelTypes["teamtimes_sum_order_by"] | undefined,
	var_pop?: ModelTypes["teamtimes_var_pop_order_by"] | undefined,
	var_samp?: ModelTypes["teamtimes_var_samp_order_by"] | undefined,
	variance?: ModelTypes["teamtimes_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "teamtimes" */
["teamtimes_arr_rel_insert_input"]: {
	data: Array<ModelTypes["teamtimes_insert_input"]>,
	/** upsert condition */
	on_conflict?: ModelTypes["teamtimes_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["teamtimes_avg_fields"]: {
		team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by avg() on columns of table "teamtimes" */
["teamtimes_avg_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "teamtimes". All fields are combined with a logical 'AND'. */
["teamtimes_bool_exp"]: {
	_and?: Array<ModelTypes["teamtimes_bool_exp"]> | undefined,
	_not?: ModelTypes["teamtimes_bool_exp"] | undefined,
	_or?: Array<ModelTypes["teamtimes_bool_exp"]> | undefined,
	duration?: ModelTypes["time_comparison_exp"] | undefined,
	team_id?: ModelTypes["Int_comparison_exp"] | undefined,
	time?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	time_id?: ModelTypes["Int_comparison_exp"] | undefined
};
	["teamtimes_constraint"]:teamtimes_constraint;
	/** input type for incrementing numeric columns in table "teamtimes" */
["teamtimes_inc_input"]: {
	team_id?: number | undefined,
	time_id?: number | undefined
};
	/** input type for inserting data into table "teamtimes" */
["teamtimes_insert_input"]: {
	duration?: ModelTypes["time"] | undefined,
	team_id?: number | undefined,
	time?: ModelTypes["timestamptz"] | undefined,
	time_id?: number | undefined
};
	/** aggregate max on columns */
["teamtimes_max_fields"]: {
		team_id?: number | undefined,
	time?: ModelTypes["timestamptz"] | undefined,
	time_id?: number | undefined
};
	/** order by max() on columns of table "teamtimes" */
["teamtimes_max_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["teamtimes_min_fields"]: {
		team_id?: number | undefined,
	time?: ModelTypes["timestamptz"] | undefined,
	time_id?: number | undefined
};
	/** order by min() on columns of table "teamtimes" */
["teamtimes_min_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	/** response of any mutation on the table "teamtimes" */
["teamtimes_mutation_response"]: {
		/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<ModelTypes["teamtimes"]>
};
	/** on_conflict condition type for table "teamtimes" */
["teamtimes_on_conflict"]: {
	constraint: ModelTypes["teamtimes_constraint"],
	update_columns: Array<ModelTypes["teamtimes_update_column"]>,
	where?: ModelTypes["teamtimes_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "teamtimes". */
["teamtimes_order_by"]: {
	duration?: ModelTypes["order_by"] | undefined,
	team_id?: ModelTypes["order_by"] | undefined,
	time?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	/** primary key columns input for table: teamtimes */
["teamtimes_pk_columns_input"]: {
	time_id: number
};
	["teamtimes_select_column"]:teamtimes_select_column;
	/** input type for updating data in table "teamtimes" */
["teamtimes_set_input"]: {
	duration?: ModelTypes["time"] | undefined,
	team_id?: number | undefined,
	time?: ModelTypes["timestamptz"] | undefined,
	time_id?: number | undefined
};
	/** aggregate stddev on columns */
["teamtimes_stddev_fields"]: {
		team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by stddev() on columns of table "teamtimes" */
["teamtimes_stddev_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["teamtimes_stddev_pop_fields"]: {
		team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "teamtimes" */
["teamtimes_stddev_pop_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["teamtimes_stddev_samp_fields"]: {
		team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "teamtimes" */
["teamtimes_stddev_samp_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["teamtimes_sum_fields"]: {
		team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by sum() on columns of table "teamtimes" */
["teamtimes_sum_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	["teamtimes_update_column"]:teamtimes_update_column;
	/** aggregate var_pop on columns */
["teamtimes_var_pop_fields"]: {
		team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by var_pop() on columns of table "teamtimes" */
["teamtimes_var_pop_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["teamtimes_var_samp_fields"]: {
		team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by var_samp() on columns of table "teamtimes" */
["teamtimes_var_samp_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["teamtimes_variance_fields"]: {
		team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by variance() on columns of table "teamtimes" */
["teamtimes_variance_order_by"]: {
	team_id?: ModelTypes["order_by"] | undefined,
	time_id?: ModelTypes["order_by"] | undefined
};
	["time"]:any;
	/** Boolean expression to compare columns of type "time". All fields are combined with logical 'AND'. */
["time_comparison_exp"]: {
	_eq?: ModelTypes["time"] | undefined,
	_gt?: ModelTypes["time"] | undefined,
	_gte?: ModelTypes["time"] | undefined,
	_in?: Array<ModelTypes["time"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: ModelTypes["time"] | undefined,
	_lte?: ModelTypes["time"] | undefined,
	_neq?: ModelTypes["time"] | undefined,
	_nin?: Array<ModelTypes["time"]> | undefined
};
	["timestamptz"]:any;
	/** Boolean expression to compare columns of type "timestamptz". All fields are combined with logical 'AND'. */
["timestamptz_comparison_exp"]: {
	_eq?: ModelTypes["timestamptz"] | undefined,
	_gt?: ModelTypes["timestamptz"] | undefined,
	_gte?: ModelTypes["timestamptz"] | undefined,
	_in?: Array<ModelTypes["timestamptz"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: ModelTypes["timestamptz"] | undefined,
	_lte?: ModelTypes["timestamptz"] | undefined,
	_neq?: ModelTypes["timestamptz"] | undefined,
	_nin?: Array<ModelTypes["timestamptz"]> | undefined
};
	/** columns and relationships of "usermemberships" */
["usermemberships"]: {
		/** An object relationship */
	guild?: ModelTypes["guilds"] | undefined,
	guild_id?: number | undefined,
	role?: string | undefined,
	/** An object relationship */
	user?: ModelTypes["users"] | undefined,
	user_id?: number | undefined
};
	/** aggregated selection of "usermemberships" */
["usermemberships_aggregate"]: {
		aggregate?: ModelTypes["usermemberships_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["usermemberships"]>
};
	/** aggregate fields of "usermemberships" */
["usermemberships_aggregate_fields"]: {
		avg?: ModelTypes["usermemberships_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["usermemberships_max_fields"] | undefined,
	min?: ModelTypes["usermemberships_min_fields"] | undefined,
	stddev?: ModelTypes["usermemberships_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["usermemberships_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["usermemberships_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["usermemberships_sum_fields"] | undefined,
	var_pop?: ModelTypes["usermemberships_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["usermemberships_var_samp_fields"] | undefined,
	variance?: ModelTypes["usermemberships_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["usermemberships_avg_fields"]: {
		guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "usermemberships". All fields are combined with a logical 'AND'. */
["usermemberships_bool_exp"]: {
	_and?: Array<ModelTypes["usermemberships_bool_exp"]> | undefined,
	_not?: ModelTypes["usermemberships_bool_exp"] | undefined,
	_or?: Array<ModelTypes["usermemberships_bool_exp"]> | undefined,
	guild?: ModelTypes["guilds_bool_exp"] | undefined,
	guild_id?: ModelTypes["Int_comparison_exp"] | undefined,
	role?: ModelTypes["String_comparison_exp"] | undefined,
	user?: ModelTypes["users_bool_exp"] | undefined,
	user_id?: ModelTypes["Int_comparison_exp"] | undefined
};
	/** aggregate max on columns */
["usermemberships_max_fields"]: {
		guild_id?: number | undefined,
	role?: string | undefined,
	user_id?: number | undefined
};
	/** aggregate min on columns */
["usermemberships_min_fields"]: {
		guild_id?: number | undefined,
	role?: string | undefined,
	user_id?: number | undefined
};
	/** Ordering options when selecting data from "usermemberships". */
["usermemberships_order_by"]: {
	guild?: ModelTypes["guilds_order_by"] | undefined,
	guild_id?: ModelTypes["order_by"] | undefined,
	role?: ModelTypes["order_by"] | undefined,
	user?: ModelTypes["users_order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined
};
	["usermemberships_select_column"]:usermemberships_select_column;
	/** aggregate stddev on columns */
["usermemberships_stddev_fields"]: {
		guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["usermemberships_stddev_pop_fields"]: {
		guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["usermemberships_stddev_samp_fields"]: {
		guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["usermemberships_sum_fields"]: {
		guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_pop on columns */
["usermemberships_var_pop_fields"]: {
		guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["usermemberships_var_samp_fields"]: {
		guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["usermemberships_variance_fields"]: {
		guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** columns and relationships of "userprofiles" */
["userprofiles"]: {
		avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	discriminator?: ModelTypes["smallint"] | undefined,
	/** An object relationship */
	profile?: ModelTypes["profiles"] | undefined,
	profile_id?: number | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	/** An object relationship */
	user?: ModelTypes["users"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregated selection of "userprofiles" */
["userprofiles_aggregate"]: {
		aggregate?: ModelTypes["userprofiles_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["userprofiles"]>
};
	/** aggregate fields of "userprofiles" */
["userprofiles_aggregate_fields"]: {
		avg?: ModelTypes["userprofiles_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["userprofiles_max_fields"] | undefined,
	min?: ModelTypes["userprofiles_min_fields"] | undefined,
	stddev?: ModelTypes["userprofiles_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["userprofiles_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["userprofiles_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["userprofiles_sum_fields"] | undefined,
	var_pop?: ModelTypes["userprofiles_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["userprofiles_var_samp_fields"] | undefined,
	variance?: ModelTypes["userprofiles_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["userprofiles_avg_fields"]: {
		discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "userprofiles". All fields are combined with a logical 'AND'. */
["userprofiles_bool_exp"]: {
	_and?: Array<ModelTypes["userprofiles_bool_exp"]> | undefined,
	_not?: ModelTypes["userprofiles_bool_exp"] | undefined,
	_or?: Array<ModelTypes["userprofiles_bool_exp"]> | undefined,
	avatar?: ModelTypes["String_comparison_exp"] | undefined,
	created_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	discriminator?: ModelTypes["smallint_comparison_exp"] | undefined,
	profile?: ModelTypes["profiles_bool_exp"] | undefined,
	profile_id?: ModelTypes["Int_comparison_exp"] | undefined,
	snowflake?: ModelTypes["bigint_comparison_exp"] | undefined,
	updated_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	user?: ModelTypes["users_bool_exp"] | undefined,
	user_id?: ModelTypes["Int_comparison_exp"] | undefined,
	username?: ModelTypes["String_comparison_exp"] | undefined
};
	/** aggregate max on columns */
["userprofiles_max_fields"]: {
		avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	discriminator?: ModelTypes["smallint"] | undefined,
	profile_id?: number | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregate min on columns */
["userprofiles_min_fields"]: {
		avatar?: string | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	discriminator?: ModelTypes["smallint"] | undefined,
	profile_id?: number | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** Ordering options when selecting data from "userprofiles". */
["userprofiles_order_by"]: {
	avatar?: ModelTypes["order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	discriminator?: ModelTypes["order_by"] | undefined,
	profile?: ModelTypes["profiles_order_by"] | undefined,
	profile_id?: ModelTypes["order_by"] | undefined,
	snowflake?: ModelTypes["order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined,
	user?: ModelTypes["users_order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined,
	username?: ModelTypes["order_by"] | undefined
};
	["userprofiles_select_column"]:userprofiles_select_column;
	/** aggregate stddev on columns */
["userprofiles_stddev_fields"]: {
		discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["userprofiles_stddev_pop_fields"]: {
		discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["userprofiles_stddev_samp_fields"]: {
		discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["userprofiles_sum_fields"]: {
		discriminator?: ModelTypes["smallint"] | undefined,
	profile_id?: number | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	user_id?: number | undefined
};
	/** aggregate var_pop on columns */
["userprofiles_var_pop_fields"]: {
		discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["userprofiles_var_samp_fields"]: {
		discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["userprofiles_variance_fields"]: {
		discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** columns and relationships of "users" */
["users"]: {
		/** An array relationship */
	accounts: Array<ModelTypes["guildwars2accounts"]>,
	/** An aggregate relationship */
	accounts_aggregate: ModelTypes["guildwars2accounts_aggregate"],
	created_at: ModelTypes["timestamptz"],
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	discriminator: ModelTypes["smallint"],
	snowflake: ModelTypes["bigint"],
	/** An array relationship */
	teammemberships: Array<ModelTypes["teammembers"]>,
	/** An aggregate relationship */
	teammemberships_aggregate: ModelTypes["teammembers_aggregate"],
	updated_at: ModelTypes["timestamptz"],
	user_id: number,
	username: string
};
	/** aggregated selection of "users" */
["users_aggregate"]: {
		aggregate?: ModelTypes["users_aggregate_fields"] | undefined,
	nodes: Array<ModelTypes["users"]>
};
	/** aggregate fields of "users" */
["users_aggregate_fields"]: {
		avg?: ModelTypes["users_avg_fields"] | undefined,
	count: number,
	max?: ModelTypes["users_max_fields"] | undefined,
	min?: ModelTypes["users_min_fields"] | undefined,
	stddev?: ModelTypes["users_stddev_fields"] | undefined,
	stddev_pop?: ModelTypes["users_stddev_pop_fields"] | undefined,
	stddev_samp?: ModelTypes["users_stddev_samp_fields"] | undefined,
	sum?: ModelTypes["users_sum_fields"] | undefined,
	var_pop?: ModelTypes["users_var_pop_fields"] | undefined,
	var_samp?: ModelTypes["users_var_samp_fields"] | undefined,
	variance?: ModelTypes["users_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["users_avg_fields"]: {
		discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "users". All fields are combined with a logical 'AND'. */
["users_bool_exp"]: {
	_and?: Array<ModelTypes["users_bool_exp"]> | undefined,
	_not?: ModelTypes["users_bool_exp"] | undefined,
	_or?: Array<ModelTypes["users_bool_exp"]> | undefined,
	accounts?: ModelTypes["guildwars2accounts_bool_exp"] | undefined,
	created_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	deleted_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	discriminator?: ModelTypes["smallint_comparison_exp"] | undefined,
	snowflake?: ModelTypes["bigint_comparison_exp"] | undefined,
	teammemberships?: ModelTypes["teammembers_bool_exp"] | undefined,
	updated_at?: ModelTypes["timestamptz_comparison_exp"] | undefined,
	user_id?: ModelTypes["Int_comparison_exp"] | undefined,
	username?: ModelTypes["String_comparison_exp"] | undefined
};
	["users_constraint"]:users_constraint;
	/** input type for incrementing numeric columns in table "users" */
["users_inc_input"]: {
	discriminator?: ModelTypes["smallint"] | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "users" */
["users_insert_input"]: {
	accounts?: ModelTypes["guildwars2accounts_arr_rel_insert_input"] | undefined,
	created_at?: ModelTypes["timestamptz"] | undefined,
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	discriminator?: ModelTypes["smallint"] | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	teammemberships?: ModelTypes["teammembers_arr_rel_insert_input"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregate max on columns */
["users_max_fields"]: {
		created_at?: ModelTypes["timestamptz"] | undefined,
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	discriminator?: ModelTypes["smallint"] | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregate min on columns */
["users_min_fields"]: {
		created_at?: ModelTypes["timestamptz"] | undefined,
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	discriminator?: ModelTypes["smallint"] | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** response of any mutation on the table "users" */
["users_mutation_response"]: {
		/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<ModelTypes["users"]>
};
	/** input type for inserting object relation for remote table "users" */
["users_obj_rel_insert_input"]: {
	data: ModelTypes["users_insert_input"],
	/** upsert condition */
	on_conflict?: ModelTypes["users_on_conflict"] | undefined
};
	/** on_conflict condition type for table "users" */
["users_on_conflict"]: {
	constraint: ModelTypes["users_constraint"],
	update_columns: Array<ModelTypes["users_update_column"]>,
	where?: ModelTypes["users_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "users". */
["users_order_by"]: {
	accounts_aggregate?: ModelTypes["guildwars2accounts_aggregate_order_by"] | undefined,
	created_at?: ModelTypes["order_by"] | undefined,
	deleted_at?: ModelTypes["order_by"] | undefined,
	discriminator?: ModelTypes["order_by"] | undefined,
	snowflake?: ModelTypes["order_by"] | undefined,
	teammemberships_aggregate?: ModelTypes["teammembers_aggregate_order_by"] | undefined,
	updated_at?: ModelTypes["order_by"] | undefined,
	user_id?: ModelTypes["order_by"] | undefined,
	username?: ModelTypes["order_by"] | undefined
};
	/** primary key columns input for table: users */
["users_pk_columns_input"]: {
	user_id: number
};
	["users_select_column"]:users_select_column;
	/** input type for updating data in table "users" */
["users_set_input"]: {
	created_at?: ModelTypes["timestamptz"] | undefined,
	deleted_at?: ModelTypes["timestamptz"] | undefined,
	discriminator?: ModelTypes["smallint"] | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	updated_at?: ModelTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregate stddev on columns */
["users_stddev_fields"]: {
		discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["users_stddev_pop_fields"]: {
		discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["users_stddev_samp_fields"]: {
		discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["users_sum_fields"]: {
		discriminator?: ModelTypes["smallint"] | undefined,
	snowflake?: ModelTypes["bigint"] | undefined,
	user_id?: number | undefined
};
	["users_update_column"]:users_update_column;
	/** aggregate var_pop on columns */
["users_var_pop_fields"]: {
		discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["users_var_samp_fields"]: {
		discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["users_variance_fields"]: {
		discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	["visibility"]:any;
	/** Boolean expression to compare columns of type "visibility". All fields are combined with logical 'AND'. */
["visibility_comparison_exp"]: {
	_eq?: ModelTypes["visibility"] | undefined,
	_gt?: ModelTypes["visibility"] | undefined,
	_gte?: ModelTypes["visibility"] | undefined,
	_in?: Array<ModelTypes["visibility"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: ModelTypes["visibility"] | undefined,
	_lte?: ModelTypes["visibility"] | undefined,
	_neq?: ModelTypes["visibility"] | undefined,
	_nin?: Array<ModelTypes["visibility"]> | undefined
}
    }

export type GraphQLTypes = {
    /** Boolean expression to compare columns of type "Boolean". All fields are combined with logical 'AND'. */
["Boolean_comparison_exp"]: {
		_eq?: boolean | undefined,
	_gt?: boolean | undefined,
	_gte?: boolean | undefined,
	_in?: Array<boolean> | undefined,
	_is_null?: boolean | undefined,
	_lt?: boolean | undefined,
	_lte?: boolean | undefined,
	_neq?: boolean | undefined,
	_nin?: Array<boolean> | undefined
};
	/** Boolean expression to compare columns of type "Int". All fields are combined with logical 'AND'. */
["Int_comparison_exp"]: {
		_eq?: number | undefined,
	_gt?: number | undefined,
	_gte?: number | undefined,
	_in?: Array<number> | undefined,
	_is_null?: boolean | undefined,
	_lt?: number | undefined,
	_lte?: number | undefined,
	_neq?: number | undefined,
	_nin?: Array<number> | undefined
};
	/** Boolean expression to compare columns of type "String". All fields are combined with logical 'AND'. */
["String_comparison_exp"]: {
		_eq?: string | undefined,
	_gt?: string | undefined,
	_gte?: string | undefined,
	/** does the column match the given case-insensitive pattern */
	_ilike?: string | undefined,
	_in?: Array<string> | undefined,
	/** does the column match the given POSIX regular expression, case insensitive */
	_iregex?: string | undefined,
	_is_null?: boolean | undefined,
	/** does the column match the given pattern */
	_like?: string | undefined,
	_lt?: string | undefined,
	_lte?: string | undefined,
	_neq?: string | undefined,
	/** does the column NOT match the given case-insensitive pattern */
	_nilike?: string | undefined,
	_nin?: Array<string> | undefined,
	/** does the column NOT match the given POSIX regular expression, case insensitive */
	_niregex?: string | undefined,
	/** does the column NOT match the given pattern */
	_nlike?: string | undefined,
	/** does the column NOT match the given POSIX regular expression, case sensitive */
	_nregex?: string | undefined,
	/** does the column NOT match the given SQL regular expression */
	_nsimilar?: string | undefined,
	/** does the column match the given POSIX regular expression, case sensitive */
	_regex?: string | undefined,
	/** does the column match the given SQL regular expression */
	_similar?: string | undefined
};
	["bigint"]: "scalar" & { name: "bigint" };
	/** Boolean expression to compare columns of type "bigint". All fields are combined with logical 'AND'. */
["bigint_comparison_exp"]: {
		_eq?: GraphQLTypes["bigint"] | undefined,
	_gt?: GraphQLTypes["bigint"] | undefined,
	_gte?: GraphQLTypes["bigint"] | undefined,
	_in?: Array<GraphQLTypes["bigint"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: GraphQLTypes["bigint"] | undefined,
	_lte?: GraphQLTypes["bigint"] | undefined,
	_neq?: GraphQLTypes["bigint"] | undefined,
	_nin?: Array<GraphQLTypes["bigint"]> | undefined
};
	["guildmanagerrole"]: "scalar" & { name: "guildmanagerrole" };
	/** Boolean expression to compare columns of type "guildmanagerrole". All fields are combined with logical 'AND'. */
["guildmanagerrole_comparison_exp"]: {
		_eq?: GraphQLTypes["guildmanagerrole"] | undefined,
	_gt?: GraphQLTypes["guildmanagerrole"] | undefined,
	_gte?: GraphQLTypes["guildmanagerrole"] | undefined,
	_in?: Array<GraphQLTypes["guildmanagerrole"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: GraphQLTypes["guildmanagerrole"] | undefined,
	_lte?: GraphQLTypes["guildmanagerrole"] | undefined,
	_neq?: GraphQLTypes["guildmanagerrole"] | undefined,
	_nin?: Array<GraphQLTypes["guildmanagerrole"]> | undefined
};
	/** columns and relationships of "guildmanagers" */
["guildmanagers"]: {
	__typename: "guildmanagers",
	guild_id: number,
	manager_id: number,
	role: GraphQLTypes["guildmanagerrole"],
	/** An object relationship */
	user: GraphQLTypes["users"],
	user_id: number
};
	/** aggregated selection of "guildmanagers" */
["guildmanagers_aggregate"]: {
	__typename: "guildmanagers_aggregate",
	aggregate?: GraphQLTypes["guildmanagers_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["guildmanagers"]>
};
	/** aggregate fields of "guildmanagers" */
["guildmanagers_aggregate_fields"]: {
	__typename: "guildmanagers_aggregate_fields",
	avg?: GraphQLTypes["guildmanagers_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["guildmanagers_max_fields"] | undefined,
	min?: GraphQLTypes["guildmanagers_min_fields"] | undefined,
	stddev?: GraphQLTypes["guildmanagers_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["guildmanagers_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["guildmanagers_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["guildmanagers_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["guildmanagers_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["guildmanagers_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["guildmanagers_variance_fields"] | undefined
};
	/** order by aggregate values of table "guildmanagers" */
["guildmanagers_aggregate_order_by"]: {
		avg?: GraphQLTypes["guildmanagers_avg_order_by"] | undefined,
	count?: GraphQLTypes["order_by"] | undefined,
	max?: GraphQLTypes["guildmanagers_max_order_by"] | undefined,
	min?: GraphQLTypes["guildmanagers_min_order_by"] | undefined,
	stddev?: GraphQLTypes["guildmanagers_stddev_order_by"] | undefined,
	stddev_pop?: GraphQLTypes["guildmanagers_stddev_pop_order_by"] | undefined,
	stddev_samp?: GraphQLTypes["guildmanagers_stddev_samp_order_by"] | undefined,
	sum?: GraphQLTypes["guildmanagers_sum_order_by"] | undefined,
	var_pop?: GraphQLTypes["guildmanagers_var_pop_order_by"] | undefined,
	var_samp?: GraphQLTypes["guildmanagers_var_samp_order_by"] | undefined,
	variance?: GraphQLTypes["guildmanagers_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "guildmanagers" */
["guildmanagers_arr_rel_insert_input"]: {
		data: Array<GraphQLTypes["guildmanagers_insert_input"]>,
	/** upsert condition */
	on_conflict?: GraphQLTypes["guildmanagers_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["guildmanagers_avg_fields"]: {
	__typename: "guildmanagers_avg_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by avg() on columns of table "guildmanagers" */
["guildmanagers_avg_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "guildmanagers". All fields are combined with a logical 'AND'. */
["guildmanagers_bool_exp"]: {
		_and?: Array<GraphQLTypes["guildmanagers_bool_exp"]> | undefined,
	_not?: GraphQLTypes["guildmanagers_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["guildmanagers_bool_exp"]> | undefined,
	guild_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	manager_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	role?: GraphQLTypes["guildmanagerrole_comparison_exp"] | undefined,
	user?: GraphQLTypes["users_bool_exp"] | undefined,
	user_id?: GraphQLTypes["Int_comparison_exp"] | undefined
};
	/** unique or primary key constraints on table "guildmanagers" */
["guildmanagers_constraint"]: guildmanagers_constraint;
	/** input type for incrementing numeric columns in table "guildmanagers" */
["guildmanagers_inc_input"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "guildmanagers" */
["guildmanagers_insert_input"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	role?: GraphQLTypes["guildmanagerrole"] | undefined,
	user?: GraphQLTypes["users_obj_rel_insert_input"] | undefined,
	user_id?: number | undefined
};
	/** aggregate max on columns */
["guildmanagers_max_fields"]: {
	__typename: "guildmanagers_max_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	role?: GraphQLTypes["guildmanagerrole"] | undefined,
	user_id?: number | undefined
};
	/** order by max() on columns of table "guildmanagers" */
["guildmanagers_max_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["guildmanagers_min_fields"]: {
	__typename: "guildmanagers_min_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	role?: GraphQLTypes["guildmanagerrole"] | undefined,
	user_id?: number | undefined
};
	/** order by min() on columns of table "guildmanagers" */
["guildmanagers_min_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** response of any mutation on the table "guildmanagers" */
["guildmanagers_mutation_response"]: {
	__typename: "guildmanagers_mutation_response",
	/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<GraphQLTypes["guildmanagers"]>
};
	/** on_conflict condition type for table "guildmanagers" */
["guildmanagers_on_conflict"]: {
		constraint: GraphQLTypes["guildmanagers_constraint"],
	update_columns: Array<GraphQLTypes["guildmanagers_update_column"]>,
	where?: GraphQLTypes["guildmanagers_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "guildmanagers". */
["guildmanagers_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	user?: GraphQLTypes["users_order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** primary key columns input for table: guildmanagers */
["guildmanagers_pk_columns_input"]: {
		manager_id: number
};
	/** select columns of table "guildmanagers" */
["guildmanagers_select_column"]: guildmanagers_select_column;
	/** input type for updating data in table "guildmanagers" */
["guildmanagers_set_input"]: {
		guild_id?: number | undefined,
	manager_id?: number | undefined,
	role?: GraphQLTypes["guildmanagerrole"] | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev on columns */
["guildmanagers_stddev_fields"]: {
	__typename: "guildmanagers_stddev_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev() on columns of table "guildmanagers" */
["guildmanagers_stddev_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["guildmanagers_stddev_pop_fields"]: {
	__typename: "guildmanagers_stddev_pop_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "guildmanagers" */
["guildmanagers_stddev_pop_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["guildmanagers_stddev_samp_fields"]: {
	__typename: "guildmanagers_stddev_samp_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "guildmanagers" */
["guildmanagers_stddev_samp_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["guildmanagers_sum_fields"]: {
	__typename: "guildmanagers_sum_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by sum() on columns of table "guildmanagers" */
["guildmanagers_sum_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** update columns of table "guildmanagers" */
["guildmanagers_update_column"]: guildmanagers_update_column;
	/** aggregate var_pop on columns */
["guildmanagers_var_pop_fields"]: {
	__typename: "guildmanagers_var_pop_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_pop() on columns of table "guildmanagers" */
["guildmanagers_var_pop_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["guildmanagers_var_samp_fields"]: {
	__typename: "guildmanagers_var_samp_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_samp() on columns of table "guildmanagers" */
["guildmanagers_var_samp_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["guildmanagers_variance_fields"]: {
	__typename: "guildmanagers_variance_fields",
	guild_id?: number | undefined,
	manager_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by variance() on columns of table "guildmanagers" */
["guildmanagers_variance_order_by"]: {
		guild_id?: GraphQLTypes["order_by"] | undefined,
	manager_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** columns and relationships of "guildmembers" */
["guildmembers"]: {
	__typename: "guildmembers",
	avatar?: string | undefined,
	guild_id: number,
	member_id: number,
	nickname?: string | undefined,
	user_id: number
};
	/** aggregated selection of "guildmembers" */
["guildmembers_aggregate"]: {
	__typename: "guildmembers_aggregate",
	aggregate?: GraphQLTypes["guildmembers_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["guildmembers"]>
};
	/** aggregate fields of "guildmembers" */
["guildmembers_aggregate_fields"]: {
	__typename: "guildmembers_aggregate_fields",
	avg?: GraphQLTypes["guildmembers_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["guildmembers_max_fields"] | undefined,
	min?: GraphQLTypes["guildmembers_min_fields"] | undefined,
	stddev?: GraphQLTypes["guildmembers_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["guildmembers_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["guildmembers_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["guildmembers_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["guildmembers_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["guildmembers_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["guildmembers_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["guildmembers_avg_fields"]: {
	__typename: "guildmembers_avg_fields",
	guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "guildmembers". All fields are combined with a logical 'AND'. */
["guildmembers_bool_exp"]: {
		_and?: Array<GraphQLTypes["guildmembers_bool_exp"]> | undefined,
	_not?: GraphQLTypes["guildmembers_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["guildmembers_bool_exp"]> | undefined,
	avatar?: GraphQLTypes["String_comparison_exp"] | undefined,
	guild_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	member_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	nickname?: GraphQLTypes["String_comparison_exp"] | undefined,
	user_id?: GraphQLTypes["Int_comparison_exp"] | undefined
};
	/** unique or primary key constraints on table "guildmembers" */
["guildmembers_constraint"]: guildmembers_constraint;
	/** input type for incrementing numeric columns in table "guildmembers" */
["guildmembers_inc_input"]: {
		guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "guildmembers" */
["guildmembers_insert_input"]: {
		avatar?: string | undefined,
	guild_id?: number | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	user_id?: number | undefined
};
	/** aggregate max on columns */
["guildmembers_max_fields"]: {
	__typename: "guildmembers_max_fields",
	avatar?: string | undefined,
	guild_id?: number | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	user_id?: number | undefined
};
	/** aggregate min on columns */
["guildmembers_min_fields"]: {
	__typename: "guildmembers_min_fields",
	avatar?: string | undefined,
	guild_id?: number | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	user_id?: number | undefined
};
	/** response of any mutation on the table "guildmembers" */
["guildmembers_mutation_response"]: {
	__typename: "guildmembers_mutation_response",
	/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<GraphQLTypes["guildmembers"]>
};
	/** on_conflict condition type for table "guildmembers" */
["guildmembers_on_conflict"]: {
		constraint: GraphQLTypes["guildmembers_constraint"],
	update_columns: Array<GraphQLTypes["guildmembers_update_column"]>,
	where?: GraphQLTypes["guildmembers_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "guildmembers". */
["guildmembers_order_by"]: {
		avatar?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	member_id?: GraphQLTypes["order_by"] | undefined,
	nickname?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** primary key columns input for table: guildmembers */
["guildmembers_pk_columns_input"]: {
		member_id: number
};
	/** select columns of table "guildmembers" */
["guildmembers_select_column"]: guildmembers_select_column;
	/** input type for updating data in table "guildmembers" */
["guildmembers_set_input"]: {
		avatar?: string | undefined,
	guild_id?: number | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev on columns */
["guildmembers_stddev_fields"]: {
	__typename: "guildmembers_stddev_fields",
	guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["guildmembers_stddev_pop_fields"]: {
	__typename: "guildmembers_stddev_pop_fields",
	guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["guildmembers_stddev_samp_fields"]: {
	__typename: "guildmembers_stddev_samp_fields",
	guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["guildmembers_sum_fields"]: {
	__typename: "guildmembers_sum_fields",
	guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** update columns of table "guildmembers" */
["guildmembers_update_column"]: guildmembers_update_column;
	/** aggregate var_pop on columns */
["guildmembers_var_pop_fields"]: {
	__typename: "guildmembers_var_pop_fields",
	guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["guildmembers_var_samp_fields"]: {
	__typename: "guildmembers_var_samp_fields",
	guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["guildmembers_variance_fields"]: {
	__typename: "guildmembers_variance_fields",
	guild_id?: number | undefined,
	member_id?: number | undefined,
	user_id?: number | undefined
};
	/** columns and relationships of "guilds" */
["guilds"]: {
	__typename: "guilds",
	alias: string,
	created_at: GraphQLTypes["timestamptz"],
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id: number,
	icon?: string | undefined,
	manager_role?: GraphQLTypes["bigint"] | undefined,
	/** An array relationship */
	managers: Array<GraphQLTypes["guildmanagers"]>,
	/** An aggregate relationship */
	managers_aggregate: GraphQLTypes["guildmanagers_aggregate"],
	moderator_role?: GraphQLTypes["bigint"] | undefined,
	name: string,
	preferred_locale: string,
	snowflake: GraphQLTypes["bigint"],
	/** An array relationship */
	teams: Array<GraphQLTypes["teams"]>,
	/** An aggregate relationship */
	teams_aggregate: GraphQLTypes["teams_aggregate"],
	updated_at: GraphQLTypes["timestamptz"]
};
	/** aggregated selection of "guilds" */
["guilds_aggregate"]: {
	__typename: "guilds_aggregate",
	aggregate?: GraphQLTypes["guilds_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["guilds"]>
};
	/** aggregate fields of "guilds" */
["guilds_aggregate_fields"]: {
	__typename: "guilds_aggregate_fields",
	avg?: GraphQLTypes["guilds_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["guilds_max_fields"] | undefined,
	min?: GraphQLTypes["guilds_min_fields"] | undefined,
	stddev?: GraphQLTypes["guilds_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["guilds_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["guilds_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["guilds_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["guilds_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["guilds_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["guilds_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["guilds_avg_fields"]: {
	__typename: "guilds_avg_fields",
	guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** Boolean expression to filter rows from the table "guilds". All fields are combined with a logical 'AND'. */
["guilds_bool_exp"]: {
		_and?: Array<GraphQLTypes["guilds_bool_exp"]> | undefined,
	_not?: GraphQLTypes["guilds_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["guilds_bool_exp"]> | undefined,
	alias?: GraphQLTypes["String_comparison_exp"] | undefined,
	created_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	description?: GraphQLTypes["String_comparison_exp"] | undefined,
	guild_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	icon?: GraphQLTypes["String_comparison_exp"] | undefined,
	manager_role?: GraphQLTypes["bigint_comparison_exp"] | undefined,
	managers?: GraphQLTypes["guildmanagers_bool_exp"] | undefined,
	moderator_role?: GraphQLTypes["bigint_comparison_exp"] | undefined,
	name?: GraphQLTypes["String_comparison_exp"] | undefined,
	preferred_locale?: GraphQLTypes["String_comparison_exp"] | undefined,
	snowflake?: GraphQLTypes["bigint_comparison_exp"] | undefined,
	teams?: GraphQLTypes["teams_bool_exp"] | undefined,
	updated_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined
};
	/** unique or primary key constraints on table "guilds" */
["guilds_constraint"]: guilds_constraint;
	/** input type for incrementing numeric columns in table "guilds" */
["guilds_inc_input"]: {
		guild_id?: number | undefined,
	manager_role?: GraphQLTypes["bigint"] | undefined,
	moderator_role?: GraphQLTypes["bigint"] | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined
};
	/** input type for inserting data into table "guilds" */
["guilds_insert_input"]: {
		alias?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	manager_role?: GraphQLTypes["bigint"] | undefined,
	managers?: GraphQLTypes["guildmanagers_arr_rel_insert_input"] | undefined,
	moderator_role?: GraphQLTypes["bigint"] | undefined,
	name?: string | undefined,
	preferred_locale?: string | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	teams?: GraphQLTypes["teams_arr_rel_insert_input"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined
};
	/** aggregate max on columns */
["guilds_max_fields"]: {
	__typename: "guilds_max_fields",
	alias?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	manager_role?: GraphQLTypes["bigint"] | undefined,
	moderator_role?: GraphQLTypes["bigint"] | undefined,
	name?: string | undefined,
	preferred_locale?: string | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined
};
	/** aggregate min on columns */
["guilds_min_fields"]: {
	__typename: "guilds_min_fields",
	alias?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	manager_role?: GraphQLTypes["bigint"] | undefined,
	moderator_role?: GraphQLTypes["bigint"] | undefined,
	name?: string | undefined,
	preferred_locale?: string | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined
};
	/** response of any mutation on the table "guilds" */
["guilds_mutation_response"]: {
	__typename: "guilds_mutation_response",
	/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<GraphQLTypes["guilds"]>
};
	/** on_conflict condition type for table "guilds" */
["guilds_on_conflict"]: {
		constraint: GraphQLTypes["guilds_constraint"],
	update_columns: Array<GraphQLTypes["guilds_update_column"]>,
	where?: GraphQLTypes["guilds_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "guilds". */
["guilds_order_by"]: {
		alias?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	deleted_at?: GraphQLTypes["order_by"] | undefined,
	description?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	icon?: GraphQLTypes["order_by"] | undefined,
	manager_role?: GraphQLTypes["order_by"] | undefined,
	managers_aggregate?: GraphQLTypes["guildmanagers_aggregate_order_by"] | undefined,
	moderator_role?: GraphQLTypes["order_by"] | undefined,
	name?: GraphQLTypes["order_by"] | undefined,
	preferred_locale?: GraphQLTypes["order_by"] | undefined,
	snowflake?: GraphQLTypes["order_by"] | undefined,
	teams_aggregate?: GraphQLTypes["teams_aggregate_order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined
};
	/** primary key columns input for table: guilds */
["guilds_pk_columns_input"]: {
		guild_id: number
};
	/** select columns of table "guilds" */
["guilds_select_column"]: guilds_select_column;
	/** input type for updating data in table "guilds" */
["guilds_set_input"]: {
		alias?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	manager_role?: GraphQLTypes["bigint"] | undefined,
	moderator_role?: GraphQLTypes["bigint"] | undefined,
	name?: string | undefined,
	preferred_locale?: string | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined
};
	/** aggregate stddev on columns */
["guilds_stddev_fields"]: {
	__typename: "guilds_stddev_fields",
	guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate stddev_pop on columns */
["guilds_stddev_pop_fields"]: {
	__typename: "guilds_stddev_pop_fields",
	guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate stddev_samp on columns */
["guilds_stddev_samp_fields"]: {
	__typename: "guilds_stddev_samp_fields",
	guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate sum on columns */
["guilds_sum_fields"]: {
	__typename: "guilds_sum_fields",
	guild_id?: number | undefined,
	manager_role?: GraphQLTypes["bigint"] | undefined,
	moderator_role?: GraphQLTypes["bigint"] | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined
};
	/** update columns of table "guilds" */
["guilds_update_column"]: guilds_update_column;
	/** aggregate var_pop on columns */
["guilds_var_pop_fields"]: {
	__typename: "guilds_var_pop_fields",
	guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate var_samp on columns */
["guilds_var_samp_fields"]: {
	__typename: "guilds_var_samp_fields",
	guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** aggregate variance on columns */
["guilds_variance_fields"]: {
	__typename: "guilds_variance_fields",
	guild_id?: number | undefined,
	manager_role?: number | undefined,
	moderator_role?: number | undefined,
	snowflake?: number | undefined
};
	/** columns and relationships of "guildwars2accounts" */
["guildwars2accounts"]: {
	__typename: "guildwars2accounts",
	account_id: number,
	api_key?: string | undefined,
	created_at: GraphQLTypes["timestamptz"],
	main: boolean,
	updated_at: GraphQLTypes["timestamptz"],
	user_id: number,
	verified: boolean
};
	/** aggregated selection of "guildwars2accounts" */
["guildwars2accounts_aggregate"]: {
	__typename: "guildwars2accounts_aggregate",
	aggregate?: GraphQLTypes["guildwars2accounts_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["guildwars2accounts"]>
};
	/** aggregate fields of "guildwars2accounts" */
["guildwars2accounts_aggregate_fields"]: {
	__typename: "guildwars2accounts_aggregate_fields",
	avg?: GraphQLTypes["guildwars2accounts_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["guildwars2accounts_max_fields"] | undefined,
	min?: GraphQLTypes["guildwars2accounts_min_fields"] | undefined,
	stddev?: GraphQLTypes["guildwars2accounts_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["guildwars2accounts_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["guildwars2accounts_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["guildwars2accounts_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["guildwars2accounts_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["guildwars2accounts_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["guildwars2accounts_variance_fields"] | undefined
};
	/** order by aggregate values of table "guildwars2accounts" */
["guildwars2accounts_aggregate_order_by"]: {
		avg?: GraphQLTypes["guildwars2accounts_avg_order_by"] | undefined,
	count?: GraphQLTypes["order_by"] | undefined,
	max?: GraphQLTypes["guildwars2accounts_max_order_by"] | undefined,
	min?: GraphQLTypes["guildwars2accounts_min_order_by"] | undefined,
	stddev?: GraphQLTypes["guildwars2accounts_stddev_order_by"] | undefined,
	stddev_pop?: GraphQLTypes["guildwars2accounts_stddev_pop_order_by"] | undefined,
	stddev_samp?: GraphQLTypes["guildwars2accounts_stddev_samp_order_by"] | undefined,
	sum?: GraphQLTypes["guildwars2accounts_sum_order_by"] | undefined,
	var_pop?: GraphQLTypes["guildwars2accounts_var_pop_order_by"] | undefined,
	var_samp?: GraphQLTypes["guildwars2accounts_var_samp_order_by"] | undefined,
	variance?: GraphQLTypes["guildwars2accounts_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "guildwars2accounts" */
["guildwars2accounts_arr_rel_insert_input"]: {
		data: Array<GraphQLTypes["guildwars2accounts_insert_input"]>,
	/** upsert condition */
	on_conflict?: GraphQLTypes["guildwars2accounts_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["guildwars2accounts_avg_fields"]: {
	__typename: "guildwars2accounts_avg_fields",
	account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by avg() on columns of table "guildwars2accounts" */
["guildwars2accounts_avg_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "guildwars2accounts". All fields are combined with a logical 'AND'. */
["guildwars2accounts_bool_exp"]: {
		_and?: Array<GraphQLTypes["guildwars2accounts_bool_exp"]> | undefined,
	_not?: GraphQLTypes["guildwars2accounts_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["guildwars2accounts_bool_exp"]> | undefined,
	account_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	api_key?: GraphQLTypes["String_comparison_exp"] | undefined,
	created_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	main?: GraphQLTypes["Boolean_comparison_exp"] | undefined,
	updated_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	user_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	verified?: GraphQLTypes["Boolean_comparison_exp"] | undefined
};
	/** unique or primary key constraints on table "guildwars2accounts" */
["guildwars2accounts_constraint"]: guildwars2accounts_constraint;
	/** input type for incrementing numeric columns in table "guildwars2accounts" */
["guildwars2accounts_inc_input"]: {
		account_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "guildwars2accounts" */
["guildwars2accounts_insert_input"]: {
		account_id?: number | undefined,
	api_key?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	main?: boolean | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	verified?: boolean | undefined
};
	/** aggregate max on columns */
["guildwars2accounts_max_fields"]: {
	__typename: "guildwars2accounts_max_fields",
	account_id?: number | undefined,
	api_key?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** order by max() on columns of table "guildwars2accounts" */
["guildwars2accounts_max_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	api_key?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["guildwars2accounts_min_fields"]: {
	__typename: "guildwars2accounts_min_fields",
	account_id?: number | undefined,
	api_key?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** order by min() on columns of table "guildwars2accounts" */
["guildwars2accounts_min_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	api_key?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** response of any mutation on the table "guildwars2accounts" */
["guildwars2accounts_mutation_response"]: {
	__typename: "guildwars2accounts_mutation_response",
	/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<GraphQLTypes["guildwars2accounts"]>
};
	/** on_conflict condition type for table "guildwars2accounts" */
["guildwars2accounts_on_conflict"]: {
		constraint: GraphQLTypes["guildwars2accounts_constraint"],
	update_columns: Array<GraphQLTypes["guildwars2accounts_update_column"]>,
	where?: GraphQLTypes["guildwars2accounts_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "guildwars2accounts". */
["guildwars2accounts_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	api_key?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	main?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined,
	verified?: GraphQLTypes["order_by"] | undefined
};
	/** primary key columns input for table: guildwars2accounts */
["guildwars2accounts_pk_columns_input"]: {
		account_id: number
};
	/** select columns of table "guildwars2accounts" */
["guildwars2accounts_select_column"]: guildwars2accounts_select_column;
	/** input type for updating data in table "guildwars2accounts" */
["guildwars2accounts_set_input"]: {
		account_id?: number | undefined,
	api_key?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	main?: boolean | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	verified?: boolean | undefined
};
	/** aggregate stddev on columns */
["guildwars2accounts_stddev_fields"]: {
	__typename: "guildwars2accounts_stddev_fields",
	account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["guildwars2accounts_stddev_pop_fields"]: {
	__typename: "guildwars2accounts_stddev_pop_fields",
	account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_pop_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["guildwars2accounts_stddev_samp_fields"]: {
	__typename: "guildwars2accounts_stddev_samp_fields",
	account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "guildwars2accounts" */
["guildwars2accounts_stddev_samp_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["guildwars2accounts_sum_fields"]: {
	__typename: "guildwars2accounts_sum_fields",
	account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by sum() on columns of table "guildwars2accounts" */
["guildwars2accounts_sum_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** update columns of table "guildwars2accounts" */
["guildwars2accounts_update_column"]: guildwars2accounts_update_column;
	/** aggregate var_pop on columns */
["guildwars2accounts_var_pop_fields"]: {
	__typename: "guildwars2accounts_var_pop_fields",
	account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_pop() on columns of table "guildwars2accounts" */
["guildwars2accounts_var_pop_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["guildwars2accounts_var_samp_fields"]: {
	__typename: "guildwars2accounts_var_samp_fields",
	account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_samp() on columns of table "guildwars2accounts" */
["guildwars2accounts_var_samp_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["guildwars2accounts_variance_fields"]: {
	__typename: "guildwars2accounts_variance_fields",
	account_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by variance() on columns of table "guildwars2accounts" */
["guildwars2accounts_variance_order_by"]: {
		account_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** mutation root */
["mutation_root"]: {
	__typename: "mutation_root",
	/** delete data from the table: "guildmanagers" */
	delete_guildmanagers?: GraphQLTypes["guildmanagers_mutation_response"] | undefined,
	/** delete single row from the table: "guildmanagers" */
	delete_guildmanagers_by_pk?: GraphQLTypes["guildmanagers"] | undefined,
	/** delete data from the table: "guildmembers" */
	delete_guildmembers?: GraphQLTypes["guildmembers_mutation_response"] | undefined,
	/** delete single row from the table: "guildmembers" */
	delete_guildmembers_by_pk?: GraphQLTypes["guildmembers"] | undefined,
	/** delete data from the table: "guilds" */
	delete_guilds?: GraphQLTypes["guilds_mutation_response"] | undefined,
	/** delete single row from the table: "guilds" */
	delete_guilds_by_pk?: GraphQLTypes["guilds"] | undefined,
	/** delete data from the table: "guildwars2accounts" */
	delete_guildwars2accounts?: GraphQLTypes["guildwars2accounts_mutation_response"] | undefined,
	/** delete single row from the table: "guildwars2accounts" */
	delete_guildwars2accounts_by_pk?: GraphQLTypes["guildwars2accounts"] | undefined,
	/** delete data from the table: "profiles" */
	delete_profiles?: GraphQLTypes["profiles_mutation_response"] | undefined,
	/** delete single row from the table: "profiles" */
	delete_profiles_by_pk?: GraphQLTypes["profiles"] | undefined,
	/** delete data from the table: "teammembers" */
	delete_teammembers?: GraphQLTypes["teammembers_mutation_response"] | undefined,
	/** delete single row from the table: "teammembers" */
	delete_teammembers_by_pk?: GraphQLTypes["teammembers"] | undefined,
	/** delete data from the table: "teams" */
	delete_teams?: GraphQLTypes["teams_mutation_response"] | undefined,
	/** delete single row from the table: "teams" */
	delete_teams_by_pk?: GraphQLTypes["teams"] | undefined,
	/** delete data from the table: "teamtimes" */
	delete_teamtimes?: GraphQLTypes["teamtimes_mutation_response"] | undefined,
	/** delete single row from the table: "teamtimes" */
	delete_teamtimes_by_pk?: GraphQLTypes["teamtimes"] | undefined,
	/** delete data from the table: "users" */
	delete_users?: GraphQLTypes["users_mutation_response"] | undefined,
	/** delete single row from the table: "users" */
	delete_users_by_pk?: GraphQLTypes["users"] | undefined,
	/** insert data into the table: "guildmanagers" */
	insert_guildmanagers?: GraphQLTypes["guildmanagers_mutation_response"] | undefined,
	/** insert a single row into the table: "guildmanagers" */
	insert_guildmanagers_one?: GraphQLTypes["guildmanagers"] | undefined,
	/** insert data into the table: "guildmembers" */
	insert_guildmembers?: GraphQLTypes["guildmembers_mutation_response"] | undefined,
	/** insert a single row into the table: "guildmembers" */
	insert_guildmembers_one?: GraphQLTypes["guildmembers"] | undefined,
	/** insert data into the table: "guilds" */
	insert_guilds?: GraphQLTypes["guilds_mutation_response"] | undefined,
	/** insert a single row into the table: "guilds" */
	insert_guilds_one?: GraphQLTypes["guilds"] | undefined,
	/** insert data into the table: "guildwars2accounts" */
	insert_guildwars2accounts?: GraphQLTypes["guildwars2accounts_mutation_response"] | undefined,
	/** insert a single row into the table: "guildwars2accounts" */
	insert_guildwars2accounts_one?: GraphQLTypes["guildwars2accounts"] | undefined,
	/** insert data into the table: "profiles" */
	insert_profiles?: GraphQLTypes["profiles_mutation_response"] | undefined,
	/** insert a single row into the table: "profiles" */
	insert_profiles_one?: GraphQLTypes["profiles"] | undefined,
	/** insert data into the table: "teammembers" */
	insert_teammembers?: GraphQLTypes["teammembers_mutation_response"] | undefined,
	/** insert a single row into the table: "teammembers" */
	insert_teammembers_one?: GraphQLTypes["teammembers"] | undefined,
	/** insert data into the table: "teams" */
	insert_teams?: GraphQLTypes["teams_mutation_response"] | undefined,
	/** insert a single row into the table: "teams" */
	insert_teams_one?: GraphQLTypes["teams"] | undefined,
	/** insert data into the table: "teamtimes" */
	insert_teamtimes?: GraphQLTypes["teamtimes_mutation_response"] | undefined,
	/** insert a single row into the table: "teamtimes" */
	insert_teamtimes_one?: GraphQLTypes["teamtimes"] | undefined,
	/** insert data into the table: "users" */
	insert_users?: GraphQLTypes["users_mutation_response"] | undefined,
	/** insert a single row into the table: "users" */
	insert_users_one?: GraphQLTypes["users"] | undefined,
	/** update data of the table: "guildmanagers" */
	update_guildmanagers?: GraphQLTypes["guildmanagers_mutation_response"] | undefined,
	/** update single row of the table: "guildmanagers" */
	update_guildmanagers_by_pk?: GraphQLTypes["guildmanagers"] | undefined,
	/** update data of the table: "guildmembers" */
	update_guildmembers?: GraphQLTypes["guildmembers_mutation_response"] | undefined,
	/** update single row of the table: "guildmembers" */
	update_guildmembers_by_pk?: GraphQLTypes["guildmembers"] | undefined,
	/** update data of the table: "guilds" */
	update_guilds?: GraphQLTypes["guilds_mutation_response"] | undefined,
	/** update single row of the table: "guilds" */
	update_guilds_by_pk?: GraphQLTypes["guilds"] | undefined,
	/** update data of the table: "guildwars2accounts" */
	update_guildwars2accounts?: GraphQLTypes["guildwars2accounts_mutation_response"] | undefined,
	/** update single row of the table: "guildwars2accounts" */
	update_guildwars2accounts_by_pk?: GraphQLTypes["guildwars2accounts"] | undefined,
	/** update data of the table: "profiles" */
	update_profiles?: GraphQLTypes["profiles_mutation_response"] | undefined,
	/** update single row of the table: "profiles" */
	update_profiles_by_pk?: GraphQLTypes["profiles"] | undefined,
	/** update data of the table: "teammembers" */
	update_teammembers?: GraphQLTypes["teammembers_mutation_response"] | undefined,
	/** update single row of the table: "teammembers" */
	update_teammembers_by_pk?: GraphQLTypes["teammembers"] | undefined,
	/** update data of the table: "teams" */
	update_teams?: GraphQLTypes["teams_mutation_response"] | undefined,
	/** update single row of the table: "teams" */
	update_teams_by_pk?: GraphQLTypes["teams"] | undefined,
	/** update data of the table: "teamtimes" */
	update_teamtimes?: GraphQLTypes["teamtimes_mutation_response"] | undefined,
	/** update single row of the table: "teamtimes" */
	update_teamtimes_by_pk?: GraphQLTypes["teamtimes"] | undefined,
	/** update data of the table: "users" */
	update_users?: GraphQLTypes["users_mutation_response"] | undefined,
	/** update single row of the table: "users" */
	update_users_by_pk?: GraphQLTypes["users"] | undefined
};
	/** column ordering options */
["order_by"]: order_by;
	/** columns and relationships of "profiles" */
["profiles"]: {
	__typename: "profiles",
	avatar: string,
	created_at: GraphQLTypes["timestamptz"],
	profile_id: number,
	updated_at: GraphQLTypes["timestamptz"],
	/** An object relationship */
	user: GraphQLTypes["users"],
	user_id: number
};
	/** aggregated selection of "profiles" */
["profiles_aggregate"]: {
	__typename: "profiles_aggregate",
	aggregate?: GraphQLTypes["profiles_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["profiles"]>
};
	/** aggregate fields of "profiles" */
["profiles_aggregate_fields"]: {
	__typename: "profiles_aggregate_fields",
	avg?: GraphQLTypes["profiles_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["profiles_max_fields"] | undefined,
	min?: GraphQLTypes["profiles_min_fields"] | undefined,
	stddev?: GraphQLTypes["profiles_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["profiles_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["profiles_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["profiles_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["profiles_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["profiles_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["profiles_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["profiles_avg_fields"]: {
	__typename: "profiles_avg_fields",
	profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "profiles". All fields are combined with a logical 'AND'. */
["profiles_bool_exp"]: {
		_and?: Array<GraphQLTypes["profiles_bool_exp"]> | undefined,
	_not?: GraphQLTypes["profiles_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["profiles_bool_exp"]> | undefined,
	avatar?: GraphQLTypes["String_comparison_exp"] | undefined,
	created_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	profile_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	updated_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	user?: GraphQLTypes["users_bool_exp"] | undefined,
	user_id?: GraphQLTypes["Int_comparison_exp"] | undefined
};
	/** unique or primary key constraints on table "profiles" */
["profiles_constraint"]: profiles_constraint;
	/** input type for incrementing numeric columns in table "profiles" */
["profiles_inc_input"]: {
		profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "profiles" */
["profiles_insert_input"]: {
		avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	profile_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user?: GraphQLTypes["users_obj_rel_insert_input"] | undefined,
	user_id?: number | undefined
};
	/** aggregate max on columns */
["profiles_max_fields"]: {
	__typename: "profiles_max_fields",
	avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	profile_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** aggregate min on columns */
["profiles_min_fields"]: {
	__typename: "profiles_min_fields",
	avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	profile_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** response of any mutation on the table "profiles" */
["profiles_mutation_response"]: {
	__typename: "profiles_mutation_response",
	/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<GraphQLTypes["profiles"]>
};
	/** on_conflict condition type for table "profiles" */
["profiles_on_conflict"]: {
		constraint: GraphQLTypes["profiles_constraint"],
	update_columns: Array<GraphQLTypes["profiles_update_column"]>,
	where?: GraphQLTypes["profiles_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "profiles". */
["profiles_order_by"]: {
		avatar?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	profile_id?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined,
	user?: GraphQLTypes["users_order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** primary key columns input for table: profiles */
["profiles_pk_columns_input"]: {
		profile_id: number
};
	/** select columns of table "profiles" */
["profiles_select_column"]: profiles_select_column;
	/** input type for updating data in table "profiles" */
["profiles_set_input"]: {
		avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	profile_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev on columns */
["profiles_stddev_fields"]: {
	__typename: "profiles_stddev_fields",
	profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["profiles_stddev_pop_fields"]: {
	__typename: "profiles_stddev_pop_fields",
	profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["profiles_stddev_samp_fields"]: {
	__typename: "profiles_stddev_samp_fields",
	profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["profiles_sum_fields"]: {
	__typename: "profiles_sum_fields",
	profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** update columns of table "profiles" */
["profiles_update_column"]: profiles_update_column;
	/** aggregate var_pop on columns */
["profiles_var_pop_fields"]: {
	__typename: "profiles_var_pop_fields",
	profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["profiles_var_samp_fields"]: {
	__typename: "profiles_var_samp_fields",
	profile_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["profiles_variance_fields"]: {
	__typename: "profiles_variance_fields",
	profile_id?: number | undefined,
	user_id?: number | undefined
};
	["query_root"]: {
	__typename: "query_root",
	/** fetch data from the table: "guildmanagers" */
	guildmanagers: Array<GraphQLTypes["guildmanagers"]>,
	/** fetch aggregated fields from the table: "guildmanagers" */
	guildmanagers_aggregate: GraphQLTypes["guildmanagers_aggregate"],
	/** fetch data from the table: "guildmanagers" using primary key columns */
	guildmanagers_by_pk?: GraphQLTypes["guildmanagers"] | undefined,
	/** fetch data from the table: "guildmembers" */
	guildmembers: Array<GraphQLTypes["guildmembers"]>,
	/** fetch aggregated fields from the table: "guildmembers" */
	guildmembers_aggregate: GraphQLTypes["guildmembers_aggregate"],
	/** fetch data from the table: "guildmembers" using primary key columns */
	guildmembers_by_pk?: GraphQLTypes["guildmembers"] | undefined,
	/** fetch data from the table: "guilds" */
	guilds: Array<GraphQLTypes["guilds"]>,
	/** fetch aggregated fields from the table: "guilds" */
	guilds_aggregate: GraphQLTypes["guilds_aggregate"],
	/** fetch data from the table: "guilds" using primary key columns */
	guilds_by_pk?: GraphQLTypes["guilds"] | undefined,
	/** fetch data from the table: "guildwars2accounts" */
	guildwars2accounts: Array<GraphQLTypes["guildwars2accounts"]>,
	/** fetch aggregated fields from the table: "guildwars2accounts" */
	guildwars2accounts_aggregate: GraphQLTypes["guildwars2accounts_aggregate"],
	/** fetch data from the table: "guildwars2accounts" using primary key columns */
	guildwars2accounts_by_pk?: GraphQLTypes["guildwars2accounts"] | undefined,
	/** fetch data from the table: "profiles" */
	profiles: Array<GraphQLTypes["profiles"]>,
	/** fetch aggregated fields from the table: "profiles" */
	profiles_aggregate: GraphQLTypes["profiles_aggregate"],
	/** fetch data from the table: "profiles" using primary key columns */
	profiles_by_pk?: GraphQLTypes["profiles"] | undefined,
	/** fetch data from the table: "teammembers" */
	teammembers: Array<GraphQLTypes["teammembers"]>,
	/** fetch aggregated fields from the table: "teammembers" */
	teammembers_aggregate: GraphQLTypes["teammembers_aggregate"],
	/** fetch data from the table: "teammembers" using primary key columns */
	teammembers_by_pk?: GraphQLTypes["teammembers"] | undefined,
	/** An array relationship */
	teams: Array<GraphQLTypes["teams"]>,
	/** An aggregate relationship */
	teams_aggregate: GraphQLTypes["teams_aggregate"],
	/** fetch data from the table: "teams" using primary key columns */
	teams_by_pk?: GraphQLTypes["teams"] | undefined,
	/** fetch data from the table: "teamtimes" */
	teamtimes: Array<GraphQLTypes["teamtimes"]>,
	/** fetch aggregated fields from the table: "teamtimes" */
	teamtimes_aggregate: GraphQLTypes["teamtimes_aggregate"],
	/** fetch data from the table: "teamtimes" using primary key columns */
	teamtimes_by_pk?: GraphQLTypes["teamtimes"] | undefined,
	/** fetch data from the table: "usermemberships" */
	usermemberships: Array<GraphQLTypes["usermemberships"]>,
	/** fetch aggregated fields from the table: "usermemberships" */
	usermemberships_aggregate: GraphQLTypes["usermemberships_aggregate"],
	/** fetch data from the table: "userprofiles" */
	userprofiles: Array<GraphQLTypes["userprofiles"]>,
	/** fetch aggregated fields from the table: "userprofiles" */
	userprofiles_aggregate: GraphQLTypes["userprofiles_aggregate"],
	/** fetch data from the table: "users" */
	users: Array<GraphQLTypes["users"]>,
	/** fetch aggregated fields from the table: "users" */
	users_aggregate: GraphQLTypes["users_aggregate"],
	/** fetch data from the table: "users" using primary key columns */
	users_by_pk?: GraphQLTypes["users"] | undefined
};
	["smallint"]: "scalar" & { name: "smallint" };
	/** Boolean expression to compare columns of type "smallint". All fields are combined with logical 'AND'. */
["smallint_comparison_exp"]: {
		_eq?: GraphQLTypes["smallint"] | undefined,
	_gt?: GraphQLTypes["smallint"] | undefined,
	_gte?: GraphQLTypes["smallint"] | undefined,
	_in?: Array<GraphQLTypes["smallint"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: GraphQLTypes["smallint"] | undefined,
	_lte?: GraphQLTypes["smallint"] | undefined,
	_neq?: GraphQLTypes["smallint"] | undefined,
	_nin?: Array<GraphQLTypes["smallint"]> | undefined
};
	["subscription_root"]: {
	__typename: "subscription_root",
	/** fetch data from the table: "guildmanagers" */
	guildmanagers: Array<GraphQLTypes["guildmanagers"]>,
	/** fetch aggregated fields from the table: "guildmanagers" */
	guildmanagers_aggregate: GraphQLTypes["guildmanagers_aggregate"],
	/** fetch data from the table: "guildmanagers" using primary key columns */
	guildmanagers_by_pk?: GraphQLTypes["guildmanagers"] | undefined,
	/** fetch data from the table: "guildmembers" */
	guildmembers: Array<GraphQLTypes["guildmembers"]>,
	/** fetch aggregated fields from the table: "guildmembers" */
	guildmembers_aggregate: GraphQLTypes["guildmembers_aggregate"],
	/** fetch data from the table: "guildmembers" using primary key columns */
	guildmembers_by_pk?: GraphQLTypes["guildmembers"] | undefined,
	/** fetch data from the table: "guilds" */
	guilds: Array<GraphQLTypes["guilds"]>,
	/** fetch aggregated fields from the table: "guilds" */
	guilds_aggregate: GraphQLTypes["guilds_aggregate"],
	/** fetch data from the table: "guilds" using primary key columns */
	guilds_by_pk?: GraphQLTypes["guilds"] | undefined,
	/** fetch data from the table: "guildwars2accounts" */
	guildwars2accounts: Array<GraphQLTypes["guildwars2accounts"]>,
	/** fetch aggregated fields from the table: "guildwars2accounts" */
	guildwars2accounts_aggregate: GraphQLTypes["guildwars2accounts_aggregate"],
	/** fetch data from the table: "guildwars2accounts" using primary key columns */
	guildwars2accounts_by_pk?: GraphQLTypes["guildwars2accounts"] | undefined,
	/** fetch data from the table: "profiles" */
	profiles: Array<GraphQLTypes["profiles"]>,
	/** fetch aggregated fields from the table: "profiles" */
	profiles_aggregate: GraphQLTypes["profiles_aggregate"],
	/** fetch data from the table: "profiles" using primary key columns */
	profiles_by_pk?: GraphQLTypes["profiles"] | undefined,
	/** fetch data from the table: "teammembers" */
	teammembers: Array<GraphQLTypes["teammembers"]>,
	/** fetch aggregated fields from the table: "teammembers" */
	teammembers_aggregate: GraphQLTypes["teammembers_aggregate"],
	/** fetch data from the table: "teammembers" using primary key columns */
	teammembers_by_pk?: GraphQLTypes["teammembers"] | undefined,
	/** An array relationship */
	teams: Array<GraphQLTypes["teams"]>,
	/** An aggregate relationship */
	teams_aggregate: GraphQLTypes["teams_aggregate"],
	/** fetch data from the table: "teams" using primary key columns */
	teams_by_pk?: GraphQLTypes["teams"] | undefined,
	/** fetch data from the table: "teamtimes" */
	teamtimes: Array<GraphQLTypes["teamtimes"]>,
	/** fetch aggregated fields from the table: "teamtimes" */
	teamtimes_aggregate: GraphQLTypes["teamtimes_aggregate"],
	/** fetch data from the table: "teamtimes" using primary key columns */
	teamtimes_by_pk?: GraphQLTypes["teamtimes"] | undefined,
	/** fetch data from the table: "usermemberships" */
	usermemberships: Array<GraphQLTypes["usermemberships"]>,
	/** fetch aggregated fields from the table: "usermemberships" */
	usermemberships_aggregate: GraphQLTypes["usermemberships_aggregate"],
	/** fetch data from the table: "userprofiles" */
	userprofiles: Array<GraphQLTypes["userprofiles"]>,
	/** fetch aggregated fields from the table: "userprofiles" */
	userprofiles_aggregate: GraphQLTypes["userprofiles_aggregate"],
	/** fetch data from the table: "users" */
	users: Array<GraphQLTypes["users"]>,
	/** fetch aggregated fields from the table: "users" */
	users_aggregate: GraphQLTypes["users_aggregate"],
	/** fetch data from the table: "users" using primary key columns */
	users_by_pk?: GraphQLTypes["users"] | undefined
};
	["teammemberrole"]: "scalar" & { name: "teammemberrole" };
	/** Boolean expression to compare columns of type "teammemberrole". All fields are combined with logical 'AND'. */
["teammemberrole_comparison_exp"]: {
		_eq?: GraphQLTypes["teammemberrole"] | undefined,
	_gt?: GraphQLTypes["teammemberrole"] | undefined,
	_gte?: GraphQLTypes["teammemberrole"] | undefined,
	_in?: Array<GraphQLTypes["teammemberrole"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: GraphQLTypes["teammemberrole"] | undefined,
	_lte?: GraphQLTypes["teammemberrole"] | undefined,
	_neq?: GraphQLTypes["teammemberrole"] | undefined,
	_nin?: Array<GraphQLTypes["teammemberrole"]> | undefined
};
	/** columns and relationships of "teammembers" */
["teammembers"]: {
	__typename: "teammembers",
	avatar?: string | undefined,
	created_at: GraphQLTypes["timestamptz"],
	member_id: number,
	nickname?: string | undefined,
	role: GraphQLTypes["teammemberrole"],
	/** An object relationship */
	team: GraphQLTypes["teams"],
	team_id: number,
	updated_at: GraphQLTypes["timestamptz"],
	/** An object relationship */
	user: GraphQLTypes["users"],
	user_id: number,
	visibility: GraphQLTypes["visibility"]
};
	/** aggregated selection of "teammembers" */
["teammembers_aggregate"]: {
	__typename: "teammembers_aggregate",
	aggregate?: GraphQLTypes["teammembers_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["teammembers"]>
};
	/** aggregate fields of "teammembers" */
["teammembers_aggregate_fields"]: {
	__typename: "teammembers_aggregate_fields",
	avg?: GraphQLTypes["teammembers_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["teammembers_max_fields"] | undefined,
	min?: GraphQLTypes["teammembers_min_fields"] | undefined,
	stddev?: GraphQLTypes["teammembers_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["teammembers_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["teammembers_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["teammembers_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["teammembers_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["teammembers_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["teammembers_variance_fields"] | undefined
};
	/** order by aggregate values of table "teammembers" */
["teammembers_aggregate_order_by"]: {
		avg?: GraphQLTypes["teammembers_avg_order_by"] | undefined,
	count?: GraphQLTypes["order_by"] | undefined,
	max?: GraphQLTypes["teammembers_max_order_by"] | undefined,
	min?: GraphQLTypes["teammembers_min_order_by"] | undefined,
	stddev?: GraphQLTypes["teammembers_stddev_order_by"] | undefined,
	stddev_pop?: GraphQLTypes["teammembers_stddev_pop_order_by"] | undefined,
	stddev_samp?: GraphQLTypes["teammembers_stddev_samp_order_by"] | undefined,
	sum?: GraphQLTypes["teammembers_sum_order_by"] | undefined,
	var_pop?: GraphQLTypes["teammembers_var_pop_order_by"] | undefined,
	var_samp?: GraphQLTypes["teammembers_var_samp_order_by"] | undefined,
	variance?: GraphQLTypes["teammembers_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "teammembers" */
["teammembers_arr_rel_insert_input"]: {
		data: Array<GraphQLTypes["teammembers_insert_input"]>,
	/** upsert condition */
	on_conflict?: GraphQLTypes["teammembers_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["teammembers_avg_fields"]: {
	__typename: "teammembers_avg_fields",
	member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by avg() on columns of table "teammembers" */
["teammembers_avg_order_by"]: {
		member_id?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "teammembers". All fields are combined with a logical 'AND'. */
["teammembers_bool_exp"]: {
		_and?: Array<GraphQLTypes["teammembers_bool_exp"]> | undefined,
	_not?: GraphQLTypes["teammembers_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["teammembers_bool_exp"]> | undefined,
	avatar?: GraphQLTypes["String_comparison_exp"] | undefined,
	created_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	member_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	nickname?: GraphQLTypes["String_comparison_exp"] | undefined,
	role?: GraphQLTypes["teammemberrole_comparison_exp"] | undefined,
	team?: GraphQLTypes["teams_bool_exp"] | undefined,
	team_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	updated_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	user?: GraphQLTypes["users_bool_exp"] | undefined,
	user_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	visibility?: GraphQLTypes["visibility_comparison_exp"] | undefined
};
	/** unique or primary key constraints on table "teammembers" */
["teammembers_constraint"]: teammembers_constraint;
	/** input type for incrementing numeric columns in table "teammembers" */
["teammembers_inc_input"]: {
		member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "teammembers" */
["teammembers_insert_input"]: {
		avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	role?: GraphQLTypes["teammemberrole"] | undefined,
	team?: GraphQLTypes["teams_obj_rel_insert_input"] | undefined,
	team_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user?: GraphQLTypes["users_obj_rel_insert_input"] | undefined,
	user_id?: number | undefined,
	visibility?: GraphQLTypes["visibility"] | undefined
};
	/** aggregate max on columns */
["teammembers_max_fields"]: {
	__typename: "teammembers_max_fields",
	avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	role?: GraphQLTypes["teammemberrole"] | undefined,
	team_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	visibility?: GraphQLTypes["visibility"] | undefined
};
	/** order by max() on columns of table "teammembers" */
["teammembers_max_order_by"]: {
		avatar?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	member_id?: GraphQLTypes["order_by"] | undefined,
	nickname?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined,
	visibility?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["teammembers_min_fields"]: {
	__typename: "teammembers_min_fields",
	avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	role?: GraphQLTypes["teammemberrole"] | undefined,
	team_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	visibility?: GraphQLTypes["visibility"] | undefined
};
	/** order by min() on columns of table "teammembers" */
["teammembers_min_order_by"]: {
		avatar?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	member_id?: GraphQLTypes["order_by"] | undefined,
	nickname?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined,
	visibility?: GraphQLTypes["order_by"] | undefined
};
	/** response of any mutation on the table "teammembers" */
["teammembers_mutation_response"]: {
	__typename: "teammembers_mutation_response",
	/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<GraphQLTypes["teammembers"]>
};
	/** on_conflict condition type for table "teammembers" */
["teammembers_on_conflict"]: {
		constraint: GraphQLTypes["teammembers_constraint"],
	update_columns: Array<GraphQLTypes["teammembers_update_column"]>,
	where?: GraphQLTypes["teammembers_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "teammembers". */
["teammembers_order_by"]: {
		avatar?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	member_id?: GraphQLTypes["order_by"] | undefined,
	nickname?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team?: GraphQLTypes["teams_order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined,
	user?: GraphQLTypes["users_order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined,
	visibility?: GraphQLTypes["order_by"] | undefined
};
	/** primary key columns input for table: teammembers */
["teammembers_pk_columns_input"]: {
		member_id: number
};
	/** select columns of table "teammembers" */
["teammembers_select_column"]: teammembers_select_column;
	/** input type for updating data in table "teammembers" */
["teammembers_set_input"]: {
		avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	member_id?: number | undefined,
	nickname?: string | undefined,
	role?: GraphQLTypes["teammemberrole"] | undefined,
	team_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	visibility?: GraphQLTypes["visibility"] | undefined
};
	/** aggregate stddev on columns */
["teammembers_stddev_fields"]: {
	__typename: "teammembers_stddev_fields",
	member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev() on columns of table "teammembers" */
["teammembers_stddev_order_by"]: {
		member_id?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["teammembers_stddev_pop_fields"]: {
	__typename: "teammembers_stddev_pop_fields",
	member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "teammembers" */
["teammembers_stddev_pop_order_by"]: {
		member_id?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["teammembers_stddev_samp_fields"]: {
	__typename: "teammembers_stddev_samp_fields",
	member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "teammembers" */
["teammembers_stddev_samp_order_by"]: {
		member_id?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["teammembers_sum_fields"]: {
	__typename: "teammembers_sum_fields",
	member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by sum() on columns of table "teammembers" */
["teammembers_sum_order_by"]: {
		member_id?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** update columns of table "teammembers" */
["teammembers_update_column"]: teammembers_update_column;
	/** aggregate var_pop on columns */
["teammembers_var_pop_fields"]: {
	__typename: "teammembers_var_pop_fields",
	member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_pop() on columns of table "teammembers" */
["teammembers_var_pop_order_by"]: {
		member_id?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["teammembers_var_samp_fields"]: {
	__typename: "teammembers_var_samp_fields",
	member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by var_samp() on columns of table "teammembers" */
["teammembers_var_samp_order_by"]: {
		member_id?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["teammembers_variance_fields"]: {
	__typename: "teammembers_variance_fields",
	member_id?: number | undefined,
	team_id?: number | undefined,
	user_id?: number | undefined
};
	/** order by variance() on columns of table "teammembers" */
["teammembers_variance_order_by"]: {
		member_id?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** columns and relationships of "teams" */
["teams"]: {
	__typename: "teams",
	alias: string,
	channel?: GraphQLTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at: GraphQLTypes["timestamptz"],
	description?: string | undefined,
	guild_id: number,
	icon?: string | undefined,
	/** An array relationship */
	members: Array<GraphQLTypes["teammembers"]>,
	/** An aggregate relationship */
	members_aggregate: GraphQLTypes["teammembers_aggregate"],
	name: string,
	role?: GraphQLTypes["bigint"] | undefined,
	team_id: number,
	/** An array relationship */
	times: Array<GraphQLTypes["teamtimes"]>,
	/** An aggregate relationship */
	times_aggregate: GraphQLTypes["teamtimes_aggregate"],
	updated_at: GraphQLTypes["timestamptz"]
};
	/** aggregated selection of "teams" */
["teams_aggregate"]: {
	__typename: "teams_aggregate",
	aggregate?: GraphQLTypes["teams_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["teams"]>
};
	/** aggregate fields of "teams" */
["teams_aggregate_fields"]: {
	__typename: "teams_aggregate_fields",
	avg?: GraphQLTypes["teams_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["teams_max_fields"] | undefined,
	min?: GraphQLTypes["teams_min_fields"] | undefined,
	stddev?: GraphQLTypes["teams_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["teams_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["teams_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["teams_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["teams_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["teams_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["teams_variance_fields"] | undefined
};
	/** order by aggregate values of table "teams" */
["teams_aggregate_order_by"]: {
		avg?: GraphQLTypes["teams_avg_order_by"] | undefined,
	count?: GraphQLTypes["order_by"] | undefined,
	max?: GraphQLTypes["teams_max_order_by"] | undefined,
	min?: GraphQLTypes["teams_min_order_by"] | undefined,
	stddev?: GraphQLTypes["teams_stddev_order_by"] | undefined,
	stddev_pop?: GraphQLTypes["teams_stddev_pop_order_by"] | undefined,
	stddev_samp?: GraphQLTypes["teams_stddev_samp_order_by"] | undefined,
	sum?: GraphQLTypes["teams_sum_order_by"] | undefined,
	var_pop?: GraphQLTypes["teams_var_pop_order_by"] | undefined,
	var_samp?: GraphQLTypes["teams_var_samp_order_by"] | undefined,
	variance?: GraphQLTypes["teams_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "teams" */
["teams_arr_rel_insert_input"]: {
		data: Array<GraphQLTypes["teams_insert_input"]>,
	/** upsert condition */
	on_conflict?: GraphQLTypes["teams_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["teams_avg_fields"]: {
	__typename: "teams_avg_fields",
	channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by avg() on columns of table "teams" */
["teams_avg_order_by"]: {
		channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "teams". All fields are combined with a logical 'AND'. */
["teams_bool_exp"]: {
		_and?: Array<GraphQLTypes["teams_bool_exp"]> | undefined,
	_not?: GraphQLTypes["teams_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["teams_bool_exp"]> | undefined,
	alias?: GraphQLTypes["String_comparison_exp"] | undefined,
	channel?: GraphQLTypes["bigint_comparison_exp"] | undefined,
	color?: GraphQLTypes["Int_comparison_exp"] | undefined,
	created_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	description?: GraphQLTypes["String_comparison_exp"] | undefined,
	guild_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	icon?: GraphQLTypes["String_comparison_exp"] | undefined,
	members?: GraphQLTypes["teammembers_bool_exp"] | undefined,
	name?: GraphQLTypes["String_comparison_exp"] | undefined,
	role?: GraphQLTypes["bigint_comparison_exp"] | undefined,
	team_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	times?: GraphQLTypes["teamtimes_bool_exp"] | undefined,
	updated_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined
};
	/** unique or primary key constraints on table "teams" */
["teams_constraint"]: teams_constraint;
	/** input type for incrementing numeric columns in table "teams" */
["teams_inc_input"]: {
		channel?: GraphQLTypes["bigint"] | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: GraphQLTypes["bigint"] | undefined,
	team_id?: number | undefined
};
	/** input type for inserting data into table "teams" */
["teams_insert_input"]: {
		alias?: string | undefined,
	channel?: GraphQLTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	members?: GraphQLTypes["teammembers_arr_rel_insert_input"] | undefined,
	name?: string | undefined,
	role?: GraphQLTypes["bigint"] | undefined,
	team_id?: number | undefined,
	times?: GraphQLTypes["teamtimes_arr_rel_insert_input"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined
};
	/** aggregate max on columns */
["teams_max_fields"]: {
	__typename: "teams_max_fields",
	alias?: string | undefined,
	channel?: GraphQLTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	name?: string | undefined,
	role?: GraphQLTypes["bigint"] | undefined,
	team_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined
};
	/** order by max() on columns of table "teams" */
["teams_max_order_by"]: {
		alias?: GraphQLTypes["order_by"] | undefined,
	channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	description?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	icon?: GraphQLTypes["order_by"] | undefined,
	name?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["teams_min_fields"]: {
	__typename: "teams_min_fields",
	alias?: string | undefined,
	channel?: GraphQLTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	name?: string | undefined,
	role?: GraphQLTypes["bigint"] | undefined,
	team_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined
};
	/** order by min() on columns of table "teams" */
["teams_min_order_by"]: {
		alias?: GraphQLTypes["order_by"] | undefined,
	channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	description?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	icon?: GraphQLTypes["order_by"] | undefined,
	name?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined
};
	/** response of any mutation on the table "teams" */
["teams_mutation_response"]: {
	__typename: "teams_mutation_response",
	/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<GraphQLTypes["teams"]>
};
	/** input type for inserting object relation for remote table "teams" */
["teams_obj_rel_insert_input"]: {
		data: GraphQLTypes["teams_insert_input"],
	/** upsert condition */
	on_conflict?: GraphQLTypes["teams_on_conflict"] | undefined
};
	/** on_conflict condition type for table "teams" */
["teams_on_conflict"]: {
		constraint: GraphQLTypes["teams_constraint"],
	update_columns: Array<GraphQLTypes["teams_update_column"]>,
	where?: GraphQLTypes["teams_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "teams". */
["teams_order_by"]: {
		alias?: GraphQLTypes["order_by"] | undefined,
	channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	description?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	icon?: GraphQLTypes["order_by"] | undefined,
	members_aggregate?: GraphQLTypes["teammembers_aggregate_order_by"] | undefined,
	name?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	times_aggregate?: GraphQLTypes["teamtimes_aggregate_order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined
};
	/** primary key columns input for table: teams */
["teams_pk_columns_input"]: {
		team_id: number
};
	/** select columns of table "teams" */
["teams_select_column"]: teams_select_column;
	/** input type for updating data in table "teams" */
["teams_set_input"]: {
		alias?: string | undefined,
	channel?: GraphQLTypes["bigint"] | undefined,
	color?: number | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	description?: string | undefined,
	guild_id?: number | undefined,
	icon?: string | undefined,
	name?: string | undefined,
	role?: GraphQLTypes["bigint"] | undefined,
	team_id?: number | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined
};
	/** aggregate stddev on columns */
["teams_stddev_fields"]: {
	__typename: "teams_stddev_fields",
	channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by stddev() on columns of table "teams" */
["teams_stddev_order_by"]: {
		channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["teams_stddev_pop_fields"]: {
	__typename: "teams_stddev_pop_fields",
	channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "teams" */
["teams_stddev_pop_order_by"]: {
		channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["teams_stddev_samp_fields"]: {
	__typename: "teams_stddev_samp_fields",
	channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "teams" */
["teams_stddev_samp_order_by"]: {
		channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["teams_sum_fields"]: {
	__typename: "teams_sum_fields",
	channel?: GraphQLTypes["bigint"] | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: GraphQLTypes["bigint"] | undefined,
	team_id?: number | undefined
};
	/** order by sum() on columns of table "teams" */
["teams_sum_order_by"]: {
		channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined
};
	/** update columns of table "teams" */
["teams_update_column"]: teams_update_column;
	/** aggregate var_pop on columns */
["teams_var_pop_fields"]: {
	__typename: "teams_var_pop_fields",
	channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by var_pop() on columns of table "teams" */
["teams_var_pop_order_by"]: {
		channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["teams_var_samp_fields"]: {
	__typename: "teams_var_samp_fields",
	channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by var_samp() on columns of table "teams" */
["teams_var_samp_order_by"]: {
		channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["teams_variance_fields"]: {
	__typename: "teams_variance_fields",
	channel?: number | undefined,
	color?: number | undefined,
	guild_id?: number | undefined,
	role?: number | undefined,
	team_id?: number | undefined
};
	/** order by variance() on columns of table "teams" */
["teams_variance_order_by"]: {
		channel?: GraphQLTypes["order_by"] | undefined,
	color?: GraphQLTypes["order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined
};
	/** columns and relationships of "teamtimes" */
["teamtimes"]: {
	__typename: "teamtimes",
	duration: GraphQLTypes["time"],
	team_id?: number | undefined,
	time: GraphQLTypes["timestamptz"],
	time_id: number
};
	/** aggregated selection of "teamtimes" */
["teamtimes_aggregate"]: {
	__typename: "teamtimes_aggregate",
	aggregate?: GraphQLTypes["teamtimes_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["teamtimes"]>
};
	/** aggregate fields of "teamtimes" */
["teamtimes_aggregate_fields"]: {
	__typename: "teamtimes_aggregate_fields",
	avg?: GraphQLTypes["teamtimes_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["teamtimes_max_fields"] | undefined,
	min?: GraphQLTypes["teamtimes_min_fields"] | undefined,
	stddev?: GraphQLTypes["teamtimes_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["teamtimes_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["teamtimes_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["teamtimes_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["teamtimes_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["teamtimes_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["teamtimes_variance_fields"] | undefined
};
	/** order by aggregate values of table "teamtimes" */
["teamtimes_aggregate_order_by"]: {
		avg?: GraphQLTypes["teamtimes_avg_order_by"] | undefined,
	count?: GraphQLTypes["order_by"] | undefined,
	max?: GraphQLTypes["teamtimes_max_order_by"] | undefined,
	min?: GraphQLTypes["teamtimes_min_order_by"] | undefined,
	stddev?: GraphQLTypes["teamtimes_stddev_order_by"] | undefined,
	stddev_pop?: GraphQLTypes["teamtimes_stddev_pop_order_by"] | undefined,
	stddev_samp?: GraphQLTypes["teamtimes_stddev_samp_order_by"] | undefined,
	sum?: GraphQLTypes["teamtimes_sum_order_by"] | undefined,
	var_pop?: GraphQLTypes["teamtimes_var_pop_order_by"] | undefined,
	var_samp?: GraphQLTypes["teamtimes_var_samp_order_by"] | undefined,
	variance?: GraphQLTypes["teamtimes_variance_order_by"] | undefined
};
	/** input type for inserting array relation for remote table "teamtimes" */
["teamtimes_arr_rel_insert_input"]: {
		data: Array<GraphQLTypes["teamtimes_insert_input"]>,
	/** upsert condition */
	on_conflict?: GraphQLTypes["teamtimes_on_conflict"] | undefined
};
	/** aggregate avg on columns */
["teamtimes_avg_fields"]: {
	__typename: "teamtimes_avg_fields",
	team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by avg() on columns of table "teamtimes" */
["teamtimes_avg_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** Boolean expression to filter rows from the table "teamtimes". All fields are combined with a logical 'AND'. */
["teamtimes_bool_exp"]: {
		_and?: Array<GraphQLTypes["teamtimes_bool_exp"]> | undefined,
	_not?: GraphQLTypes["teamtimes_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["teamtimes_bool_exp"]> | undefined,
	duration?: GraphQLTypes["time_comparison_exp"] | undefined,
	team_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	time?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	time_id?: GraphQLTypes["Int_comparison_exp"] | undefined
};
	/** unique or primary key constraints on table "teamtimes" */
["teamtimes_constraint"]: teamtimes_constraint;
	/** input type for incrementing numeric columns in table "teamtimes" */
["teamtimes_inc_input"]: {
		team_id?: number | undefined,
	time_id?: number | undefined
};
	/** input type for inserting data into table "teamtimes" */
["teamtimes_insert_input"]: {
		duration?: GraphQLTypes["time"] | undefined,
	team_id?: number | undefined,
	time?: GraphQLTypes["timestamptz"] | undefined,
	time_id?: number | undefined
};
	/** aggregate max on columns */
["teamtimes_max_fields"]: {
	__typename: "teamtimes_max_fields",
	team_id?: number | undefined,
	time?: GraphQLTypes["timestamptz"] | undefined,
	time_id?: number | undefined
};
	/** order by max() on columns of table "teamtimes" */
["teamtimes_max_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate min on columns */
["teamtimes_min_fields"]: {
	__typename: "teamtimes_min_fields",
	team_id?: number | undefined,
	time?: GraphQLTypes["timestamptz"] | undefined,
	time_id?: number | undefined
};
	/** order by min() on columns of table "teamtimes" */
["teamtimes_min_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** response of any mutation on the table "teamtimes" */
["teamtimes_mutation_response"]: {
	__typename: "teamtimes_mutation_response",
	/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<GraphQLTypes["teamtimes"]>
};
	/** on_conflict condition type for table "teamtimes" */
["teamtimes_on_conflict"]: {
		constraint: GraphQLTypes["teamtimes_constraint"],
	update_columns: Array<GraphQLTypes["teamtimes_update_column"]>,
	where?: GraphQLTypes["teamtimes_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "teamtimes". */
["teamtimes_order_by"]: {
		duration?: GraphQLTypes["order_by"] | undefined,
	team_id?: GraphQLTypes["order_by"] | undefined,
	time?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** primary key columns input for table: teamtimes */
["teamtimes_pk_columns_input"]: {
		time_id: number
};
	/** select columns of table "teamtimes" */
["teamtimes_select_column"]: teamtimes_select_column;
	/** input type for updating data in table "teamtimes" */
["teamtimes_set_input"]: {
		duration?: GraphQLTypes["time"] | undefined,
	team_id?: number | undefined,
	time?: GraphQLTypes["timestamptz"] | undefined,
	time_id?: number | undefined
};
	/** aggregate stddev on columns */
["teamtimes_stddev_fields"]: {
	__typename: "teamtimes_stddev_fields",
	team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by stddev() on columns of table "teamtimes" */
["teamtimes_stddev_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_pop on columns */
["teamtimes_stddev_pop_fields"]: {
	__typename: "teamtimes_stddev_pop_fields",
	team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by stddev_pop() on columns of table "teamtimes" */
["teamtimes_stddev_pop_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate stddev_samp on columns */
["teamtimes_stddev_samp_fields"]: {
	__typename: "teamtimes_stddev_samp_fields",
	team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by stddev_samp() on columns of table "teamtimes" */
["teamtimes_stddev_samp_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate sum on columns */
["teamtimes_sum_fields"]: {
	__typename: "teamtimes_sum_fields",
	team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by sum() on columns of table "teamtimes" */
["teamtimes_sum_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** update columns of table "teamtimes" */
["teamtimes_update_column"]: teamtimes_update_column;
	/** aggregate var_pop on columns */
["teamtimes_var_pop_fields"]: {
	__typename: "teamtimes_var_pop_fields",
	team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by var_pop() on columns of table "teamtimes" */
["teamtimes_var_pop_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate var_samp on columns */
["teamtimes_var_samp_fields"]: {
	__typename: "teamtimes_var_samp_fields",
	team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by var_samp() on columns of table "teamtimes" */
["teamtimes_var_samp_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	/** aggregate variance on columns */
["teamtimes_variance_fields"]: {
	__typename: "teamtimes_variance_fields",
	team_id?: number | undefined,
	time_id?: number | undefined
};
	/** order by variance() on columns of table "teamtimes" */
["teamtimes_variance_order_by"]: {
		team_id?: GraphQLTypes["order_by"] | undefined,
	time_id?: GraphQLTypes["order_by"] | undefined
};
	["time"]: "scalar" & { name: "time" };
	/** Boolean expression to compare columns of type "time". All fields are combined with logical 'AND'. */
["time_comparison_exp"]: {
		_eq?: GraphQLTypes["time"] | undefined,
	_gt?: GraphQLTypes["time"] | undefined,
	_gte?: GraphQLTypes["time"] | undefined,
	_in?: Array<GraphQLTypes["time"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: GraphQLTypes["time"] | undefined,
	_lte?: GraphQLTypes["time"] | undefined,
	_neq?: GraphQLTypes["time"] | undefined,
	_nin?: Array<GraphQLTypes["time"]> | undefined
};
	["timestamptz"]: "scalar" & { name: "timestamptz" };
	/** Boolean expression to compare columns of type "timestamptz". All fields are combined with logical 'AND'. */
["timestamptz_comparison_exp"]: {
		_eq?: GraphQLTypes["timestamptz"] | undefined,
	_gt?: GraphQLTypes["timestamptz"] | undefined,
	_gte?: GraphQLTypes["timestamptz"] | undefined,
	_in?: Array<GraphQLTypes["timestamptz"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: GraphQLTypes["timestamptz"] | undefined,
	_lte?: GraphQLTypes["timestamptz"] | undefined,
	_neq?: GraphQLTypes["timestamptz"] | undefined,
	_nin?: Array<GraphQLTypes["timestamptz"]> | undefined
};
	/** columns and relationships of "usermemberships" */
["usermemberships"]: {
	__typename: "usermemberships",
	/** An object relationship */
	guild?: GraphQLTypes["guilds"] | undefined,
	guild_id?: number | undefined,
	role?: string | undefined,
	/** An object relationship */
	user?: GraphQLTypes["users"] | undefined,
	user_id?: number | undefined
};
	/** aggregated selection of "usermemberships" */
["usermemberships_aggregate"]: {
	__typename: "usermemberships_aggregate",
	aggregate?: GraphQLTypes["usermemberships_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["usermemberships"]>
};
	/** aggregate fields of "usermemberships" */
["usermemberships_aggregate_fields"]: {
	__typename: "usermemberships_aggregate_fields",
	avg?: GraphQLTypes["usermemberships_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["usermemberships_max_fields"] | undefined,
	min?: GraphQLTypes["usermemberships_min_fields"] | undefined,
	stddev?: GraphQLTypes["usermemberships_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["usermemberships_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["usermemberships_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["usermemberships_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["usermemberships_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["usermemberships_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["usermemberships_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["usermemberships_avg_fields"]: {
	__typename: "usermemberships_avg_fields",
	guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "usermemberships". All fields are combined with a logical 'AND'. */
["usermemberships_bool_exp"]: {
		_and?: Array<GraphQLTypes["usermemberships_bool_exp"]> | undefined,
	_not?: GraphQLTypes["usermemberships_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["usermemberships_bool_exp"]> | undefined,
	guild?: GraphQLTypes["guilds_bool_exp"] | undefined,
	guild_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	role?: GraphQLTypes["String_comparison_exp"] | undefined,
	user?: GraphQLTypes["users_bool_exp"] | undefined,
	user_id?: GraphQLTypes["Int_comparison_exp"] | undefined
};
	/** aggregate max on columns */
["usermemberships_max_fields"]: {
	__typename: "usermemberships_max_fields",
	guild_id?: number | undefined,
	role?: string | undefined,
	user_id?: number | undefined
};
	/** aggregate min on columns */
["usermemberships_min_fields"]: {
	__typename: "usermemberships_min_fields",
	guild_id?: number | undefined,
	role?: string | undefined,
	user_id?: number | undefined
};
	/** Ordering options when selecting data from "usermemberships". */
["usermemberships_order_by"]: {
		guild?: GraphQLTypes["guilds_order_by"] | undefined,
	guild_id?: GraphQLTypes["order_by"] | undefined,
	role?: GraphQLTypes["order_by"] | undefined,
	user?: GraphQLTypes["users_order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined
};
	/** select columns of table "usermemberships" */
["usermemberships_select_column"]: usermemberships_select_column;
	/** aggregate stddev on columns */
["usermemberships_stddev_fields"]: {
	__typename: "usermemberships_stddev_fields",
	guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["usermemberships_stddev_pop_fields"]: {
	__typename: "usermemberships_stddev_pop_fields",
	guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["usermemberships_stddev_samp_fields"]: {
	__typename: "usermemberships_stddev_samp_fields",
	guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["usermemberships_sum_fields"]: {
	__typename: "usermemberships_sum_fields",
	guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_pop on columns */
["usermemberships_var_pop_fields"]: {
	__typename: "usermemberships_var_pop_fields",
	guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["usermemberships_var_samp_fields"]: {
	__typename: "usermemberships_var_samp_fields",
	guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["usermemberships_variance_fields"]: {
	__typename: "usermemberships_variance_fields",
	guild_id?: number | undefined,
	user_id?: number | undefined
};
	/** columns and relationships of "userprofiles" */
["userprofiles"]: {
	__typename: "userprofiles",
	avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	discriminator?: GraphQLTypes["smallint"] | undefined,
	/** An object relationship */
	profile?: GraphQLTypes["profiles"] | undefined,
	profile_id?: number | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	/** An object relationship */
	user?: GraphQLTypes["users"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregated selection of "userprofiles" */
["userprofiles_aggregate"]: {
	__typename: "userprofiles_aggregate",
	aggregate?: GraphQLTypes["userprofiles_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["userprofiles"]>
};
	/** aggregate fields of "userprofiles" */
["userprofiles_aggregate_fields"]: {
	__typename: "userprofiles_aggregate_fields",
	avg?: GraphQLTypes["userprofiles_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["userprofiles_max_fields"] | undefined,
	min?: GraphQLTypes["userprofiles_min_fields"] | undefined,
	stddev?: GraphQLTypes["userprofiles_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["userprofiles_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["userprofiles_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["userprofiles_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["userprofiles_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["userprofiles_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["userprofiles_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["userprofiles_avg_fields"]: {
	__typename: "userprofiles_avg_fields",
	discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "userprofiles". All fields are combined with a logical 'AND'. */
["userprofiles_bool_exp"]: {
		_and?: Array<GraphQLTypes["userprofiles_bool_exp"]> | undefined,
	_not?: GraphQLTypes["userprofiles_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["userprofiles_bool_exp"]> | undefined,
	avatar?: GraphQLTypes["String_comparison_exp"] | undefined,
	created_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	discriminator?: GraphQLTypes["smallint_comparison_exp"] | undefined,
	profile?: GraphQLTypes["profiles_bool_exp"] | undefined,
	profile_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	snowflake?: GraphQLTypes["bigint_comparison_exp"] | undefined,
	updated_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	user?: GraphQLTypes["users_bool_exp"] | undefined,
	user_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	username?: GraphQLTypes["String_comparison_exp"] | undefined
};
	/** aggregate max on columns */
["userprofiles_max_fields"]: {
	__typename: "userprofiles_max_fields",
	avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	discriminator?: GraphQLTypes["smallint"] | undefined,
	profile_id?: number | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregate min on columns */
["userprofiles_min_fields"]: {
	__typename: "userprofiles_min_fields",
	avatar?: string | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	discriminator?: GraphQLTypes["smallint"] | undefined,
	profile_id?: number | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** Ordering options when selecting data from "userprofiles". */
["userprofiles_order_by"]: {
		avatar?: GraphQLTypes["order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	discriminator?: GraphQLTypes["order_by"] | undefined,
	profile?: GraphQLTypes["profiles_order_by"] | undefined,
	profile_id?: GraphQLTypes["order_by"] | undefined,
	snowflake?: GraphQLTypes["order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined,
	user?: GraphQLTypes["users_order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined,
	username?: GraphQLTypes["order_by"] | undefined
};
	/** select columns of table "userprofiles" */
["userprofiles_select_column"]: userprofiles_select_column;
	/** aggregate stddev on columns */
["userprofiles_stddev_fields"]: {
	__typename: "userprofiles_stddev_fields",
	discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["userprofiles_stddev_pop_fields"]: {
	__typename: "userprofiles_stddev_pop_fields",
	discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["userprofiles_stddev_samp_fields"]: {
	__typename: "userprofiles_stddev_samp_fields",
	discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["userprofiles_sum_fields"]: {
	__typename: "userprofiles_sum_fields",
	discriminator?: GraphQLTypes["smallint"] | undefined,
	profile_id?: number | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	user_id?: number | undefined
};
	/** aggregate var_pop on columns */
["userprofiles_var_pop_fields"]: {
	__typename: "userprofiles_var_pop_fields",
	discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["userprofiles_var_samp_fields"]: {
	__typename: "userprofiles_var_samp_fields",
	discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["userprofiles_variance_fields"]: {
	__typename: "userprofiles_variance_fields",
	discriminator?: number | undefined,
	profile_id?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** columns and relationships of "users" */
["users"]: {
	__typename: "users",
	/** An array relationship */
	accounts: Array<GraphQLTypes["guildwars2accounts"]>,
	/** An aggregate relationship */
	accounts_aggregate: GraphQLTypes["guildwars2accounts_aggregate"],
	created_at: GraphQLTypes["timestamptz"],
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	discriminator: GraphQLTypes["smallint"],
	snowflake: GraphQLTypes["bigint"],
	/** An array relationship */
	teammemberships: Array<GraphQLTypes["teammembers"]>,
	/** An aggregate relationship */
	teammemberships_aggregate: GraphQLTypes["teammembers_aggregate"],
	updated_at: GraphQLTypes["timestamptz"],
	user_id: number,
	username: string
};
	/** aggregated selection of "users" */
["users_aggregate"]: {
	__typename: "users_aggregate",
	aggregate?: GraphQLTypes["users_aggregate_fields"] | undefined,
	nodes: Array<GraphQLTypes["users"]>
};
	/** aggregate fields of "users" */
["users_aggregate_fields"]: {
	__typename: "users_aggregate_fields",
	avg?: GraphQLTypes["users_avg_fields"] | undefined,
	count: number,
	max?: GraphQLTypes["users_max_fields"] | undefined,
	min?: GraphQLTypes["users_min_fields"] | undefined,
	stddev?: GraphQLTypes["users_stddev_fields"] | undefined,
	stddev_pop?: GraphQLTypes["users_stddev_pop_fields"] | undefined,
	stddev_samp?: GraphQLTypes["users_stddev_samp_fields"] | undefined,
	sum?: GraphQLTypes["users_sum_fields"] | undefined,
	var_pop?: GraphQLTypes["users_var_pop_fields"] | undefined,
	var_samp?: GraphQLTypes["users_var_samp_fields"] | undefined,
	variance?: GraphQLTypes["users_variance_fields"] | undefined
};
	/** aggregate avg on columns */
["users_avg_fields"]: {
	__typename: "users_avg_fields",
	discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** Boolean expression to filter rows from the table "users". All fields are combined with a logical 'AND'. */
["users_bool_exp"]: {
		_and?: Array<GraphQLTypes["users_bool_exp"]> | undefined,
	_not?: GraphQLTypes["users_bool_exp"] | undefined,
	_or?: Array<GraphQLTypes["users_bool_exp"]> | undefined,
	accounts?: GraphQLTypes["guildwars2accounts_bool_exp"] | undefined,
	created_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	discriminator?: GraphQLTypes["smallint_comparison_exp"] | undefined,
	snowflake?: GraphQLTypes["bigint_comparison_exp"] | undefined,
	teammemberships?: GraphQLTypes["teammembers_bool_exp"] | undefined,
	updated_at?: GraphQLTypes["timestamptz_comparison_exp"] | undefined,
	user_id?: GraphQLTypes["Int_comparison_exp"] | undefined,
	username?: GraphQLTypes["String_comparison_exp"] | undefined
};
	/** unique or primary key constraints on table "users" */
["users_constraint"]: users_constraint;
	/** input type for incrementing numeric columns in table "users" */
["users_inc_input"]: {
		discriminator?: GraphQLTypes["smallint"] | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	user_id?: number | undefined
};
	/** input type for inserting data into table "users" */
["users_insert_input"]: {
		accounts?: GraphQLTypes["guildwars2accounts_arr_rel_insert_input"] | undefined,
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	discriminator?: GraphQLTypes["smallint"] | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	teammemberships?: GraphQLTypes["teammembers_arr_rel_insert_input"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregate max on columns */
["users_max_fields"]: {
	__typename: "users_max_fields",
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	discriminator?: GraphQLTypes["smallint"] | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregate min on columns */
["users_min_fields"]: {
	__typename: "users_min_fields",
	created_at?: GraphQLTypes["timestamptz"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	discriminator?: GraphQLTypes["smallint"] | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** response of any mutation on the table "users" */
["users_mutation_response"]: {
	__typename: "users_mutation_response",
	/** number of rows affected by the mutation */
	affected_rows: number,
	/** data from the rows affected by the mutation */
	returning: Array<GraphQLTypes["users"]>
};
	/** input type for inserting object relation for remote table "users" */
["users_obj_rel_insert_input"]: {
		data: GraphQLTypes["users_insert_input"],
	/** upsert condition */
	on_conflict?: GraphQLTypes["users_on_conflict"] | undefined
};
	/** on_conflict condition type for table "users" */
["users_on_conflict"]: {
		constraint: GraphQLTypes["users_constraint"],
	update_columns: Array<GraphQLTypes["users_update_column"]>,
	where?: GraphQLTypes["users_bool_exp"] | undefined
};
	/** Ordering options when selecting data from "users". */
["users_order_by"]: {
		accounts_aggregate?: GraphQLTypes["guildwars2accounts_aggregate_order_by"] | undefined,
	created_at?: GraphQLTypes["order_by"] | undefined,
	deleted_at?: GraphQLTypes["order_by"] | undefined,
	discriminator?: GraphQLTypes["order_by"] | undefined,
	snowflake?: GraphQLTypes["order_by"] | undefined,
	teammemberships_aggregate?: GraphQLTypes["teammembers_aggregate_order_by"] | undefined,
	updated_at?: GraphQLTypes["order_by"] | undefined,
	user_id?: GraphQLTypes["order_by"] | undefined,
	username?: GraphQLTypes["order_by"] | undefined
};
	/** primary key columns input for table: users */
["users_pk_columns_input"]: {
		user_id: number
};
	/** select columns of table "users" */
["users_select_column"]: users_select_column;
	/** input type for updating data in table "users" */
["users_set_input"]: {
		created_at?: GraphQLTypes["timestamptz"] | undefined,
	deleted_at?: GraphQLTypes["timestamptz"] | undefined,
	discriminator?: GraphQLTypes["smallint"] | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	updated_at?: GraphQLTypes["timestamptz"] | undefined,
	user_id?: number | undefined,
	username?: string | undefined
};
	/** aggregate stddev on columns */
["users_stddev_fields"]: {
	__typename: "users_stddev_fields",
	discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_pop on columns */
["users_stddev_pop_fields"]: {
	__typename: "users_stddev_pop_fields",
	discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate stddev_samp on columns */
["users_stddev_samp_fields"]: {
	__typename: "users_stddev_samp_fields",
	discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate sum on columns */
["users_sum_fields"]: {
	__typename: "users_sum_fields",
	discriminator?: GraphQLTypes["smallint"] | undefined,
	snowflake?: GraphQLTypes["bigint"] | undefined,
	user_id?: number | undefined
};
	/** update columns of table "users" */
["users_update_column"]: users_update_column;
	/** aggregate var_pop on columns */
["users_var_pop_fields"]: {
	__typename: "users_var_pop_fields",
	discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate var_samp on columns */
["users_var_samp_fields"]: {
	__typename: "users_var_samp_fields",
	discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	/** aggregate variance on columns */
["users_variance_fields"]: {
	__typename: "users_variance_fields",
	discriminator?: number | undefined,
	snowflake?: number | undefined,
	user_id?: number | undefined
};
	["visibility"]: "scalar" & { name: "visibility" };
	/** Boolean expression to compare columns of type "visibility". All fields are combined with logical 'AND'. */
["visibility_comparison_exp"]: {
		_eq?: GraphQLTypes["visibility"] | undefined,
	_gt?: GraphQLTypes["visibility"] | undefined,
	_gte?: GraphQLTypes["visibility"] | undefined,
	_in?: Array<GraphQLTypes["visibility"]> | undefined,
	_is_null?: boolean | undefined,
	_lt?: GraphQLTypes["visibility"] | undefined,
	_lte?: GraphQLTypes["visibility"] | undefined,
	_neq?: GraphQLTypes["visibility"] | undefined,
	_nin?: Array<GraphQLTypes["visibility"]> | undefined
}
    }
/** unique or primary key constraints on table "guildmanagers" */
export const enum guildmanagers_constraint {
	guildmanagers_pkey = "guildmanagers_pkey",
	manager_unique_per_guild = "manager_unique_per_guild"
}
/** select columns of table "guildmanagers" */
export const enum guildmanagers_select_column {
	guild_id = "guild_id",
	manager_id = "manager_id",
	role = "role",
	user_id = "user_id"
}
/** update columns of table "guildmanagers" */
export const enum guildmanagers_update_column {
	guild_id = "guild_id",
	manager_id = "manager_id",
	role = "role",
	user_id = "user_id"
}
/** unique or primary key constraints on table "guildmembers" */
export const enum guildmembers_constraint {
	guildmembers_pkey = "guildmembers_pkey"
}
/** select columns of table "guildmembers" */
export const enum guildmembers_select_column {
	avatar = "avatar",
	guild_id = "guild_id",
	member_id = "member_id",
	nickname = "nickname",
	user_id = "user_id"
}
/** update columns of table "guildmembers" */
export const enum guildmembers_update_column {
	avatar = "avatar",
	guild_id = "guild_id",
	member_id = "member_id",
	nickname = "nickname",
	user_id = "user_id"
}
/** unique or primary key constraints on table "guilds" */
export const enum guilds_constraint {
	guilds_lower_idx = "guilds_lower_idx",
	guilds_pkey = "guilds_pkey",
	guilds_snowflake_key = "guilds_snowflake_key"
}
/** select columns of table "guilds" */
export const enum guilds_select_column {
	alias = "alias",
	created_at = "created_at",
	deleted_at = "deleted_at",
	description = "description",
	guild_id = "guild_id",
	icon = "icon",
	manager_role = "manager_role",
	moderator_role = "moderator_role",
	name = "name",
	preferred_locale = "preferred_locale",
	snowflake = "snowflake",
	updated_at = "updated_at"
}
/** update columns of table "guilds" */
export const enum guilds_update_column {
	alias = "alias",
	created_at = "created_at",
	deleted_at = "deleted_at",
	description = "description",
	guild_id = "guild_id",
	icon = "icon",
	manager_role = "manager_role",
	moderator_role = "moderator_role",
	name = "name",
	preferred_locale = "preferred_locale",
	snowflake = "snowflake",
	updated_at = "updated_at"
}
/** unique or primary key constraints on table "guildwars2accounts" */
export const enum guildwars2accounts_constraint {
	guildwars2accounts_pkey = "guildwars2accounts_pkey"
}
/** select columns of table "guildwars2accounts" */
export const enum guildwars2accounts_select_column {
	account_id = "account_id",
	api_key = "api_key",
	created_at = "created_at",
	main = "main",
	updated_at = "updated_at",
	user_id = "user_id",
	verified = "verified"
}
/** update columns of table "guildwars2accounts" */
export const enum guildwars2accounts_update_column {
	account_id = "account_id",
	api_key = "api_key",
	created_at = "created_at",
	main = "main",
	updated_at = "updated_at",
	user_id = "user_id",
	verified = "verified"
}
/** column ordering options */
export const enum order_by {
	asc = "asc",
	asc_nulls_first = "asc_nulls_first",
	asc_nulls_last = "asc_nulls_last",
	desc = "desc",
	desc_nulls_first = "desc_nulls_first",
	desc_nulls_last = "desc_nulls_last"
}
/** unique or primary key constraints on table "profiles" */
export const enum profiles_constraint {
	profiles_pkey = "profiles_pkey",
	profiles_user_id_key = "profiles_user_id_key"
}
/** select columns of table "profiles" */
export const enum profiles_select_column {
	avatar = "avatar",
	created_at = "created_at",
	profile_id = "profile_id",
	updated_at = "updated_at",
	user_id = "user_id"
}
/** update columns of table "profiles" */
export const enum profiles_update_column {
	avatar = "avatar",
	created_at = "created_at",
	profile_id = "profile_id",
	updated_at = "updated_at",
	user_id = "user_id"
}
/** unique or primary key constraints on table "teammembers" */
export const enum teammembers_constraint {
	teammembers_pkey = "teammembers_pkey",
	teammembers_team_id_user_id_key = "teammembers_team_id_user_id_key"
}
/** select columns of table "teammembers" */
export const enum teammembers_select_column {
	avatar = "avatar",
	created_at = "created_at",
	member_id = "member_id",
	nickname = "nickname",
	role = "role",
	team_id = "team_id",
	updated_at = "updated_at",
	user_id = "user_id",
	visibility = "visibility"
}
/** update columns of table "teammembers" */
export const enum teammembers_update_column {
	avatar = "avatar",
	created_at = "created_at",
	member_id = "member_id",
	nickname = "nickname",
	role = "role",
	team_id = "team_id",
	updated_at = "updated_at",
	user_id = "user_id",
	visibility = "visibility"
}
/** unique or primary key constraints on table "teams" */
export const enum teams_constraint {
	teams_pkey = "teams_pkey",
	teams_role_key = "teams_role_key"
}
/** select columns of table "teams" */
export const enum teams_select_column {
	alias = "alias",
	channel = "channel",
	color = "color",
	created_at = "created_at",
	description = "description",
	guild_id = "guild_id",
	icon = "icon",
	name = "name",
	role = "role",
	team_id = "team_id",
	updated_at = "updated_at"
}
/** update columns of table "teams" */
export const enum teams_update_column {
	alias = "alias",
	channel = "channel",
	color = "color",
	created_at = "created_at",
	description = "description",
	guild_id = "guild_id",
	icon = "icon",
	name = "name",
	role = "role",
	team_id = "team_id",
	updated_at = "updated_at"
}
/** unique or primary key constraints on table "teamtimes" */
export const enum teamtimes_constraint {
	teamtimes_pkey = "teamtimes_pkey"
}
/** select columns of table "teamtimes" */
export const enum teamtimes_select_column {
	duration = "duration",
	team_id = "team_id",
	time = "time",
	time_id = "time_id"
}
/** update columns of table "teamtimes" */
export const enum teamtimes_update_column {
	duration = "duration",
	team_id = "team_id",
	time = "time",
	time_id = "time_id"
}
/** select columns of table "usermemberships" */
export const enum usermemberships_select_column {
	guild_id = "guild_id",
	role = "role",
	user_id = "user_id"
}
/** select columns of table "userprofiles" */
export const enum userprofiles_select_column {
	avatar = "avatar",
	created_at = "created_at",
	discriminator = "discriminator",
	profile_id = "profile_id",
	snowflake = "snowflake",
	updated_at = "updated_at",
	user_id = "user_id",
	username = "username"
}
/** unique or primary key constraints on table "users" */
export const enum users_constraint {
	users_pkey = "users_pkey",
	users_snowflake_key = "users_snowflake_key"
}
/** select columns of table "users" */
export const enum users_select_column {
	created_at = "created_at",
	deleted_at = "deleted_at",
	discriminator = "discriminator",
	snowflake = "snowflake",
	updated_at = "updated_at",
	user_id = "user_id",
	username = "username"
}
/** update columns of table "users" */
export const enum users_update_column {
	created_at = "created_at",
	deleted_at = "deleted_at",
	discriminator = "discriminator",
	snowflake = "snowflake",
	updated_at = "updated_at",
	user_id = "user_id",
	username = "username"
}

type ZEUS_VARIABLES = {
	["Boolean_comparison_exp"]: ValueTypes["Boolean_comparison_exp"];
	["Int_comparison_exp"]: ValueTypes["Int_comparison_exp"];
	["String_comparison_exp"]: ValueTypes["String_comparison_exp"];
	["bigint"]: ValueTypes["bigint"];
	["bigint_comparison_exp"]: ValueTypes["bigint_comparison_exp"];
	["guildmanagerrole"]: ValueTypes["guildmanagerrole"];
	["guildmanagerrole_comparison_exp"]: ValueTypes["guildmanagerrole_comparison_exp"];
	["guildmanagers_aggregate_order_by"]: ValueTypes["guildmanagers_aggregate_order_by"];
	["guildmanagers_arr_rel_insert_input"]: ValueTypes["guildmanagers_arr_rel_insert_input"];
	["guildmanagers_avg_order_by"]: ValueTypes["guildmanagers_avg_order_by"];
	["guildmanagers_bool_exp"]: ValueTypes["guildmanagers_bool_exp"];
	["guildmanagers_constraint"]: ValueTypes["guildmanagers_constraint"];
	["guildmanagers_inc_input"]: ValueTypes["guildmanagers_inc_input"];
	["guildmanagers_insert_input"]: ValueTypes["guildmanagers_insert_input"];
	["guildmanagers_max_order_by"]: ValueTypes["guildmanagers_max_order_by"];
	["guildmanagers_min_order_by"]: ValueTypes["guildmanagers_min_order_by"];
	["guildmanagers_on_conflict"]: ValueTypes["guildmanagers_on_conflict"];
	["guildmanagers_order_by"]: ValueTypes["guildmanagers_order_by"];
	["guildmanagers_pk_columns_input"]: ValueTypes["guildmanagers_pk_columns_input"];
	["guildmanagers_select_column"]: ValueTypes["guildmanagers_select_column"];
	["guildmanagers_set_input"]: ValueTypes["guildmanagers_set_input"];
	["guildmanagers_stddev_order_by"]: ValueTypes["guildmanagers_stddev_order_by"];
	["guildmanagers_stddev_pop_order_by"]: ValueTypes["guildmanagers_stddev_pop_order_by"];
	["guildmanagers_stddev_samp_order_by"]: ValueTypes["guildmanagers_stddev_samp_order_by"];
	["guildmanagers_sum_order_by"]: ValueTypes["guildmanagers_sum_order_by"];
	["guildmanagers_update_column"]: ValueTypes["guildmanagers_update_column"];
	["guildmanagers_var_pop_order_by"]: ValueTypes["guildmanagers_var_pop_order_by"];
	["guildmanagers_var_samp_order_by"]: ValueTypes["guildmanagers_var_samp_order_by"];
	["guildmanagers_variance_order_by"]: ValueTypes["guildmanagers_variance_order_by"];
	["guildmembers_bool_exp"]: ValueTypes["guildmembers_bool_exp"];
	["guildmembers_constraint"]: ValueTypes["guildmembers_constraint"];
	["guildmembers_inc_input"]: ValueTypes["guildmembers_inc_input"];
	["guildmembers_insert_input"]: ValueTypes["guildmembers_insert_input"];
	["guildmembers_on_conflict"]: ValueTypes["guildmembers_on_conflict"];
	["guildmembers_order_by"]: ValueTypes["guildmembers_order_by"];
	["guildmembers_pk_columns_input"]: ValueTypes["guildmembers_pk_columns_input"];
	["guildmembers_select_column"]: ValueTypes["guildmembers_select_column"];
	["guildmembers_set_input"]: ValueTypes["guildmembers_set_input"];
	["guildmembers_update_column"]: ValueTypes["guildmembers_update_column"];
	["guilds_bool_exp"]: ValueTypes["guilds_bool_exp"];
	["guilds_constraint"]: ValueTypes["guilds_constraint"];
	["guilds_inc_input"]: ValueTypes["guilds_inc_input"];
	["guilds_insert_input"]: ValueTypes["guilds_insert_input"];
	["guilds_on_conflict"]: ValueTypes["guilds_on_conflict"];
	["guilds_order_by"]: ValueTypes["guilds_order_by"];
	["guilds_pk_columns_input"]: ValueTypes["guilds_pk_columns_input"];
	["guilds_select_column"]: ValueTypes["guilds_select_column"];
	["guilds_set_input"]: ValueTypes["guilds_set_input"];
	["guilds_update_column"]: ValueTypes["guilds_update_column"];
	["guildwars2accounts_aggregate_order_by"]: ValueTypes["guildwars2accounts_aggregate_order_by"];
	["guildwars2accounts_arr_rel_insert_input"]: ValueTypes["guildwars2accounts_arr_rel_insert_input"];
	["guildwars2accounts_avg_order_by"]: ValueTypes["guildwars2accounts_avg_order_by"];
	["guildwars2accounts_bool_exp"]: ValueTypes["guildwars2accounts_bool_exp"];
	["guildwars2accounts_constraint"]: ValueTypes["guildwars2accounts_constraint"];
	["guildwars2accounts_inc_input"]: ValueTypes["guildwars2accounts_inc_input"];
	["guildwars2accounts_insert_input"]: ValueTypes["guildwars2accounts_insert_input"];
	["guildwars2accounts_max_order_by"]: ValueTypes["guildwars2accounts_max_order_by"];
	["guildwars2accounts_min_order_by"]: ValueTypes["guildwars2accounts_min_order_by"];
	["guildwars2accounts_on_conflict"]: ValueTypes["guildwars2accounts_on_conflict"];
	["guildwars2accounts_order_by"]: ValueTypes["guildwars2accounts_order_by"];
	["guildwars2accounts_pk_columns_input"]: ValueTypes["guildwars2accounts_pk_columns_input"];
	["guildwars2accounts_select_column"]: ValueTypes["guildwars2accounts_select_column"];
	["guildwars2accounts_set_input"]: ValueTypes["guildwars2accounts_set_input"];
	["guildwars2accounts_stddev_order_by"]: ValueTypes["guildwars2accounts_stddev_order_by"];
	["guildwars2accounts_stddev_pop_order_by"]: ValueTypes["guildwars2accounts_stddev_pop_order_by"];
	["guildwars2accounts_stddev_samp_order_by"]: ValueTypes["guildwars2accounts_stddev_samp_order_by"];
	["guildwars2accounts_sum_order_by"]: ValueTypes["guildwars2accounts_sum_order_by"];
	["guildwars2accounts_update_column"]: ValueTypes["guildwars2accounts_update_column"];
	["guildwars2accounts_var_pop_order_by"]: ValueTypes["guildwars2accounts_var_pop_order_by"];
	["guildwars2accounts_var_samp_order_by"]: ValueTypes["guildwars2accounts_var_samp_order_by"];
	["guildwars2accounts_variance_order_by"]: ValueTypes["guildwars2accounts_variance_order_by"];
	["order_by"]: ValueTypes["order_by"];
	["profiles_bool_exp"]: ValueTypes["profiles_bool_exp"];
	["profiles_constraint"]: ValueTypes["profiles_constraint"];
	["profiles_inc_input"]: ValueTypes["profiles_inc_input"];
	["profiles_insert_input"]: ValueTypes["profiles_insert_input"];
	["profiles_on_conflict"]: ValueTypes["profiles_on_conflict"];
	["profiles_order_by"]: ValueTypes["profiles_order_by"];
	["profiles_pk_columns_input"]: ValueTypes["profiles_pk_columns_input"];
	["profiles_select_column"]: ValueTypes["profiles_select_column"];
	["profiles_set_input"]: ValueTypes["profiles_set_input"];
	["profiles_update_column"]: ValueTypes["profiles_update_column"];
	["smallint"]: ValueTypes["smallint"];
	["smallint_comparison_exp"]: ValueTypes["smallint_comparison_exp"];
	["teammemberrole"]: ValueTypes["teammemberrole"];
	["teammemberrole_comparison_exp"]: ValueTypes["teammemberrole_comparison_exp"];
	["teammembers_aggregate_order_by"]: ValueTypes["teammembers_aggregate_order_by"];
	["teammembers_arr_rel_insert_input"]: ValueTypes["teammembers_arr_rel_insert_input"];
	["teammembers_avg_order_by"]: ValueTypes["teammembers_avg_order_by"];
	["teammembers_bool_exp"]: ValueTypes["teammembers_bool_exp"];
	["teammembers_constraint"]: ValueTypes["teammembers_constraint"];
	["teammembers_inc_input"]: ValueTypes["teammembers_inc_input"];
	["teammembers_insert_input"]: ValueTypes["teammembers_insert_input"];
	["teammembers_max_order_by"]: ValueTypes["teammembers_max_order_by"];
	["teammembers_min_order_by"]: ValueTypes["teammembers_min_order_by"];
	["teammembers_on_conflict"]: ValueTypes["teammembers_on_conflict"];
	["teammembers_order_by"]: ValueTypes["teammembers_order_by"];
	["teammembers_pk_columns_input"]: ValueTypes["teammembers_pk_columns_input"];
	["teammembers_select_column"]: ValueTypes["teammembers_select_column"];
	["teammembers_set_input"]: ValueTypes["teammembers_set_input"];
	["teammembers_stddev_order_by"]: ValueTypes["teammembers_stddev_order_by"];
	["teammembers_stddev_pop_order_by"]: ValueTypes["teammembers_stddev_pop_order_by"];
	["teammembers_stddev_samp_order_by"]: ValueTypes["teammembers_stddev_samp_order_by"];
	["teammembers_sum_order_by"]: ValueTypes["teammembers_sum_order_by"];
	["teammembers_update_column"]: ValueTypes["teammembers_update_column"];
	["teammembers_var_pop_order_by"]: ValueTypes["teammembers_var_pop_order_by"];
	["teammembers_var_samp_order_by"]: ValueTypes["teammembers_var_samp_order_by"];
	["teammembers_variance_order_by"]: ValueTypes["teammembers_variance_order_by"];
	["teams_aggregate_order_by"]: ValueTypes["teams_aggregate_order_by"];
	["teams_arr_rel_insert_input"]: ValueTypes["teams_arr_rel_insert_input"];
	["teams_avg_order_by"]: ValueTypes["teams_avg_order_by"];
	["teams_bool_exp"]: ValueTypes["teams_bool_exp"];
	["teams_constraint"]: ValueTypes["teams_constraint"];
	["teams_inc_input"]: ValueTypes["teams_inc_input"];
	["teams_insert_input"]: ValueTypes["teams_insert_input"];
	["teams_max_order_by"]: ValueTypes["teams_max_order_by"];
	["teams_min_order_by"]: ValueTypes["teams_min_order_by"];
	["teams_obj_rel_insert_input"]: ValueTypes["teams_obj_rel_insert_input"];
	["teams_on_conflict"]: ValueTypes["teams_on_conflict"];
	["teams_order_by"]: ValueTypes["teams_order_by"];
	["teams_pk_columns_input"]: ValueTypes["teams_pk_columns_input"];
	["teams_select_column"]: ValueTypes["teams_select_column"];
	["teams_set_input"]: ValueTypes["teams_set_input"];
	["teams_stddev_order_by"]: ValueTypes["teams_stddev_order_by"];
	["teams_stddev_pop_order_by"]: ValueTypes["teams_stddev_pop_order_by"];
	["teams_stddev_samp_order_by"]: ValueTypes["teams_stddev_samp_order_by"];
	["teams_sum_order_by"]: ValueTypes["teams_sum_order_by"];
	["teams_update_column"]: ValueTypes["teams_update_column"];
	["teams_var_pop_order_by"]: ValueTypes["teams_var_pop_order_by"];
	["teams_var_samp_order_by"]: ValueTypes["teams_var_samp_order_by"];
	["teams_variance_order_by"]: ValueTypes["teams_variance_order_by"];
	["teamtimes_aggregate_order_by"]: ValueTypes["teamtimes_aggregate_order_by"];
	["teamtimes_arr_rel_insert_input"]: ValueTypes["teamtimes_arr_rel_insert_input"];
	["teamtimes_avg_order_by"]: ValueTypes["teamtimes_avg_order_by"];
	["teamtimes_bool_exp"]: ValueTypes["teamtimes_bool_exp"];
	["teamtimes_constraint"]: ValueTypes["teamtimes_constraint"];
	["teamtimes_inc_input"]: ValueTypes["teamtimes_inc_input"];
	["teamtimes_insert_input"]: ValueTypes["teamtimes_insert_input"];
	["teamtimes_max_order_by"]: ValueTypes["teamtimes_max_order_by"];
	["teamtimes_min_order_by"]: ValueTypes["teamtimes_min_order_by"];
	["teamtimes_on_conflict"]: ValueTypes["teamtimes_on_conflict"];
	["teamtimes_order_by"]: ValueTypes["teamtimes_order_by"];
	["teamtimes_pk_columns_input"]: ValueTypes["teamtimes_pk_columns_input"];
	["teamtimes_select_column"]: ValueTypes["teamtimes_select_column"];
	["teamtimes_set_input"]: ValueTypes["teamtimes_set_input"];
	["teamtimes_stddev_order_by"]: ValueTypes["teamtimes_stddev_order_by"];
	["teamtimes_stddev_pop_order_by"]: ValueTypes["teamtimes_stddev_pop_order_by"];
	["teamtimes_stddev_samp_order_by"]: ValueTypes["teamtimes_stddev_samp_order_by"];
	["teamtimes_sum_order_by"]: ValueTypes["teamtimes_sum_order_by"];
	["teamtimes_update_column"]: ValueTypes["teamtimes_update_column"];
	["teamtimes_var_pop_order_by"]: ValueTypes["teamtimes_var_pop_order_by"];
	["teamtimes_var_samp_order_by"]: ValueTypes["teamtimes_var_samp_order_by"];
	["teamtimes_variance_order_by"]: ValueTypes["teamtimes_variance_order_by"];
	["time"]: ValueTypes["time"];
	["time_comparison_exp"]: ValueTypes["time_comparison_exp"];
	["timestamptz"]: ValueTypes["timestamptz"];
	["timestamptz_comparison_exp"]: ValueTypes["timestamptz_comparison_exp"];
	["usermemberships_bool_exp"]: ValueTypes["usermemberships_bool_exp"];
	["usermemberships_order_by"]: ValueTypes["usermemberships_order_by"];
	["usermemberships_select_column"]: ValueTypes["usermemberships_select_column"];
	["userprofiles_bool_exp"]: ValueTypes["userprofiles_bool_exp"];
	["userprofiles_order_by"]: ValueTypes["userprofiles_order_by"];
	["userprofiles_select_column"]: ValueTypes["userprofiles_select_column"];
	["users_bool_exp"]: ValueTypes["users_bool_exp"];
	["users_constraint"]: ValueTypes["users_constraint"];
	["users_inc_input"]: ValueTypes["users_inc_input"];
	["users_insert_input"]: ValueTypes["users_insert_input"];
	["users_obj_rel_insert_input"]: ValueTypes["users_obj_rel_insert_input"];
	["users_on_conflict"]: ValueTypes["users_on_conflict"];
	["users_order_by"]: ValueTypes["users_order_by"];
	["users_pk_columns_input"]: ValueTypes["users_pk_columns_input"];
	["users_select_column"]: ValueTypes["users_select_column"];
	["users_set_input"]: ValueTypes["users_set_input"];
	["users_update_column"]: ValueTypes["users_update_column"];
	["visibility"]: ValueTypes["visibility"];
	["visibility_comparison_exp"]: ValueTypes["visibility_comparison_exp"];
}
