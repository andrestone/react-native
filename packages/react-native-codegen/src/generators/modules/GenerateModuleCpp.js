/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

import type {
  SchemaType,
  Nullable,
  NamedShape,
  NativeModulePropertyShape,
  NativeModuleFunctionTypeAnnotation,
  NativeModuleParamTypeAnnotation,
  NativeModuleTypeAnnotation,
} from '../../CodegenSchema';

import type {AliasResolver} from './Utils';
const {createAliasResolver, getModules} = require('./Utils');
const {unwrapNullable} = require('../../parsers/parsers-commons');

type FilesOutput = Map<string, string>;

const HostFunctionTemplate = ({
  hasteModuleName,
  methodName,
  returnTypeAnnotation,
  args,
}: $ReadOnly<{
  hasteModuleName: string,
  methodName: string,
  returnTypeAnnotation: Nullable<NativeModuleTypeAnnotation>,
  args: Array<string>,
}>) => {
  const isNullable = returnTypeAnnotation.type === 'NullableTypeAnnotation';
  const isVoid = returnTypeAnnotation.type === 'VoidTypeAnnotation';
  const methodCallArgs = ['rt', ...args].join(', ');
  const methodCall = `static_cast<${hasteModuleName}CxxSpecJSI *>(&turboModule)->${methodName}(${methodCallArgs})`;

  return `static jsi::Value __hostFunction_${hasteModuleName}CxxSpecJSI_${methodName}(jsi::Runtime &rt, TurboModule &turboModule, const jsi::Value* args, size_t count) {${
    isVoid
      ? `\n  ${methodCall};`
      : isNullable
      ? `\n  auto result = ${methodCall};`
      : ''
  }
  return ${
    isVoid
      ? 'jsi::Value::undefined()'
      : isNullable
      ? 'result ? jsi::Value(std::move(*result)) : jsi::Value::null()'
      : methodCall
  };
}`;
};

const ModuleTemplate = ({
  hasteModuleName,
  hostFunctions,
  moduleName,
  methods,
}: $ReadOnly<{
  hasteModuleName: string,
  hostFunctions: $ReadOnlyArray<string>,
  moduleName: string,
  methods: $ReadOnlyArray<$ReadOnly<{methodName: string, paramCount: number}>>,
}>) => {
  return `${hostFunctions.join('\n')}

${hasteModuleName}CxxSpecJSI::${hasteModuleName}CxxSpecJSI(std::shared_ptr<CallInvoker> jsInvoker)
  : TurboModule("${moduleName}", jsInvoker) {
${methods
  .map(({methodName, paramCount}) => {
    return `  methodMap_["${methodName}"] = MethodMetadata {${paramCount}, __hostFunction_${hasteModuleName}CxxSpecJSI_${methodName}};`;
  })
  .join('\n')}
}`;
};

const FileTemplate = ({
  libraryName,
  modules,
}: $ReadOnly<{
  libraryName: string,
  modules: string,
}>) => {
  return `/**
 * This code was generated by [react-native-codegen](https://www.npmjs.com/package/react-native-codegen).
 *
 * Do not edit this file as changes may cause incorrect behavior and will be lost
 * once the code is regenerated.
 *
 * ${'@'}generated by codegen project: GenerateModuleH.js
 */

#include "${libraryName}JSI.h"

namespace facebook {
namespace react {

${modules}


} // namespace react
} // namespace facebook
`;
};

type Param = NamedShape<Nullable<NativeModuleParamTypeAnnotation>>;

function serializeArg(
  arg: Param,
  index: number,
  resolveAlias: AliasResolver,
): string {
  const {typeAnnotation: nullableTypeAnnotation} = arg;
  const [typeAnnotation, nullable] =
    unwrapNullable<NativeModuleParamTypeAnnotation>(nullableTypeAnnotation);

  let realTypeAnnotation = typeAnnotation;
  if (realTypeAnnotation.type === 'TypeAliasTypeAnnotation') {
    realTypeAnnotation = resolveAlias(realTypeAnnotation.name);
  }

  function wrap(callback: (val: string) => string) {
    const val = `args[${index}]`;
    const expression = callback(val);

    if (nullable) {
      return `${val}.isNull() || ${val}.isUndefined() ? std::nullopt : std::make_optional(${expression})`;
    }

    return expression;
  }

  switch (realTypeAnnotation.type) {
    case 'ReservedTypeAnnotation':
      switch (realTypeAnnotation.name) {
        case 'RootTag':
          return wrap(val => `${val}.getNumber()`);
        default:
          (realTypeAnnotation.name: empty);
          throw new Error(
            `Unknown prop type for "${arg.name}, found: ${realTypeAnnotation.name}"`,
          );
      }
    case 'StringTypeAnnotation':
      return wrap(val => `${val}.asString(rt)`);
    case 'BooleanTypeAnnotation':
      return wrap(val => `${val}.asBool()`);
    case 'EnumDeclaration':
      switch (realTypeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return wrap(val => `${val}.asNumber()`);
        case 'StringTypeAnnotation':
          return wrap(val => `${val}.asString(rt)`);
        default:
          throw new Error(
            `Unknown enum type for "${arg.name}, found: ${realTypeAnnotation.type}"`,
          );
      }
    case 'NumberTypeAnnotation':
      return wrap(val => `${val}.asNumber()`);
    case 'FloatTypeAnnotation':
      return wrap(val => `${val}.asNumber()`);
    case 'DoubleTypeAnnotation':
      return wrap(val => `${val}.asNumber()`);
    case 'Int32TypeAnnotation':
      return wrap(val => `${val}.asNumber()`);
    case 'ArrayTypeAnnotation':
      return wrap(val => `${val}.asObject(rt).asArray(rt)`);
    case 'FunctionTypeAnnotation':
      return wrap(val => `${val}.asObject(rt).asFunction(rt)`);
    case 'GenericObjectTypeAnnotation':
      return wrap(val => `${val}.asObject(rt)`);
    case 'UnionTypeAnnotation':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return wrap(val => `${val}.asNumber()`);
        case 'ObjectTypeAnnotation':
          return wrap(val => `${val}.asObject(rt)`);
        case 'StringTypeAnnotation':
          return wrap(val => `${val}.asString(rt)`);
        default:
          throw new Error(
            `Unsupported union member type for param  "${arg.name}, found: ${realTypeAnnotation.memberType}"`,
          );
      }
    case 'ObjectTypeAnnotation':
      return wrap(val => `${val}.asObject(rt)`);
    case 'MixedTypeAnnotation':
      return wrap(val => `jsi::Value(rt, ${val})`);
    default:
      (realTypeAnnotation.type: empty);
      throw new Error(
        `Unknown prop type for "${arg.name}, found: ${realTypeAnnotation.type}"`,
      );
  }
}

function serializePropertyIntoHostFunction(
  hasteModuleName: string,
  property: NativeModulePropertyShape,
  resolveAlias: AliasResolver,
): string {
  const [propertyTypeAnnotation] =
    unwrapNullable<NativeModuleFunctionTypeAnnotation>(property.typeAnnotation);

  return HostFunctionTemplate({
    hasteModuleName,
    methodName: property.name,
    returnTypeAnnotation: propertyTypeAnnotation.returnTypeAnnotation,
    args: propertyTypeAnnotation.params.map((p, i) =>
      serializeArg(p, i, resolveAlias),
    ),
  });
}

module.exports = {
  generate(
    libraryName: string,
    schema: SchemaType,
    packageName?: string,
    assumeNonnull: boolean = false,
  ): FilesOutput {
    const nativeModules = getModules(schema);

    const modules = Object.keys(nativeModules)
      .map((hasteModuleName: string) => {
        const nativeModule = nativeModules[hasteModuleName];
        const {
          aliases,
          spec: {properties},
          moduleNames,
        } = nativeModule;
        const resolveAlias = createAliasResolver(aliases);
        const hostFunctions = properties.map(property =>
          serializePropertyIntoHostFunction(
            hasteModuleName,
            property,
            resolveAlias,
          ),
        );

        return ModuleTemplate({
          hasteModuleName,
          hostFunctions,
          // TODO: What happens when there are more than one NativeModule requires?
          moduleName: moduleNames[0],
          methods: properties.map(
            ({name: propertyName, typeAnnotation: nullableTypeAnnotation}) => {
              const [{params}] = unwrapNullable(nullableTypeAnnotation);
              return {
                methodName: propertyName,
                paramCount: params.length,
              };
            },
          ),
        });
      })
      .join('\n');

    const fileName = `${libraryName}JSI-generated.cpp`;
    const replacedTemplate = FileTemplate({
      modules,
      libraryName,
    });
    return new Map([[fileName, replacedTemplate]]);
  },
};
