/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var runtime = (function (exports) {
  "use strict";

  var Op = Object.prototype;
  var hasOwn = Op.hasOwnProperty;
  var defineProperty = Object.defineProperty || function (obj, key, desc) { obj[key] = desc.value; };
  var undefined; // More compressible than void 0.
  var $Symbol = typeof Symbol === "function" ? Symbol : {};
  var iteratorSymbol = $Symbol.iterator || "@@iterator";
  var asyncIteratorSymbol = $Symbol.asyncIterator || "@@asyncIterator";
  var toStringTagSymbol = $Symbol.toStringTag || "@@toStringTag";

  function define(obj, key, value) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
    return obj[key];
  }
  try {
    // IE 8 has a broken Object.defineProperty that only works on DOM objects.
    define({}, "");
  } catch (err) {
    define = function(obj, key, value) {
      return obj[key] = value;
    };
  }

  function wrap(innerFn, outerFn, self, tryLocsList) {
    // If outerFn provided and outerFn.prototype is a Generator, then outerFn.prototype instanceof Generator.
    var protoGenerator = outerFn && outerFn.prototype instanceof Generator ? outerFn : Generator;
    var generator = Object.create(protoGenerator.prototype);
    var context = new Context(tryLocsList || []);

    // The ._invoke method unifies the implementations of the .next,
    // .throw, and .return methods.
    defineProperty(generator, "_invoke", { value: makeInvokeMethod(innerFn, self, context) });

    return generator;
  }
  exports.wrap = wrap;

  // Try/catch helper to minimize deoptimizations. Returns a completion
  // record like context.tryEntries[i].completion. This interface could
  // have been (and was previously) designed to take a closure to be
  // invoked without arguments, but in all the cases we care about we
  // already have an existing method we want to call, so there's no need
  // to create a new function object. We can even get away with assuming
  // the method takes exactly one argument, since that happens to be true
  // in every case, so we don't have to touch the arguments object. The
  // only additional allocation required is the completion record, which
  // has a stable shape and so hopefully should be cheap to allocate.
  function tryCatch(fn, obj, arg) {
    try {
      return { type: "normal", arg: fn.call(obj, arg) };
    } catch (err) {
      return { type: "throw", arg: err };
    }
  }

  var GenStateSuspendedStart = "suspendedStart";
  var GenStateSuspendedYield = "suspendedYield";
  var GenStateExecuting = "executing";
  var GenStateCompleted = "completed";

  // Returning this object from the innerFn has the same effect as
  // breaking out of the dispatch switch statement.
  var ContinueSentinel = {};

  // Dummy constructor functions that we use as the .constructor and
  // .constructor.prototype properties for functions that return Generator
  // objects. For full spec compliance, you may wish to configure your
  // minifier not to mangle the names of these two functions.
  function Generator() {}
  function GeneratorFunction() {}
  function GeneratorFunctionPrototype() {}

  // This is a polyfill for %IteratorPrototype% for environments that
  // don't natively support it.
  var IteratorPrototype = {};
  define(IteratorPrototype, iteratorSymbol, function () {
    return this;
  });

  var getProto = Object.getPrototypeOf;
  var NativeIteratorPrototype = getProto && getProto(getProto(values([])));
  if (NativeIteratorPrototype &&
      NativeIteratorPrototype !== Op &&
      hasOwn.call(NativeIteratorPrototype, iteratorSymbol)) {
    // This environment has a native %IteratorPrototype%; use it instead
    // of the polyfill.
    IteratorPrototype = NativeIteratorPrototype;
  }

  var Gp = GeneratorFunctionPrototype.prototype =
    Generator.prototype = Object.create(IteratorPrototype);
  GeneratorFunction.prototype = GeneratorFunctionPrototype;
  defineProperty(Gp, "constructor", { value: GeneratorFunctionPrototype, configurable: true });
  defineProperty(
    GeneratorFunctionPrototype,
    "constructor",
    { value: GeneratorFunction, configurable: true }
  );
  GeneratorFunction.displayName = define(
    GeneratorFunctionPrototype,
    toStringTagSymbol,
    "GeneratorFunction"
  );

  // Helper for defining the .next, .throw, and .return methods of the
  // Iterator interface in terms of a single ._invoke method.
  function defineIteratorMethods(prototype) {
    ["next", "throw", "return"].forEach(function(method) {
      define(prototype, method, function(arg) {
        return this._invoke(method, arg);
      });
    });
  }

  exports.isGeneratorFunction = function(genFun) {
    var ctor = typeof genFun === "function" && genFun.constructor;
    return ctor
      ? ctor === GeneratorFunction ||
        // For the native GeneratorFunction constructor, the best we can
        // do is to check its .name property.
        (ctor.displayName || ctor.name) === "GeneratorFunction"
      : false;
  };

  exports.mark = function(genFun) {
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
    } else {
      genFun.__proto__ = GeneratorFunctionPrototype;
      define(genFun, toStringTagSymbol, "GeneratorFunction");
    }
    genFun.prototype = Object.create(Gp);
    return genFun;
  };

  // Within the body of any async function, `await x` is transformed to
  // `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
  // `hasOwn.call(value, "__await")` to determine if the yielded value is
  // meant to be awaited.
  exports.awrap = function(arg) {
    return { __await: arg };
  };

  function AsyncIterator(generator, PromiseImpl) {
    function invoke(method, arg, resolve, reject) {
      var record = tryCatch(generator[method], generator, arg);
      if (record.type === "throw") {
        reject(record.arg);
      } else {
        var result = record.arg;
        var value = result.value;
        if (value &&
            typeof value === "object" &&
            hasOwn.call(value, "__await")) {
          return PromiseImpl.resolve(value.__await).then(function(value) {
            invoke("next", value, resolve, reject);
          }, function(err) {
            invoke("throw", err, resolve, reject);
          });
        }

        return PromiseImpl.resolve(value).then(function(unwrapped) {
          // When a yielded Promise is resolved, its final value becomes
          // the .value of the Promise<{value,done}> result for the
          // current iteration.
          result.value = unwrapped;
          resolve(result);
        }, function(error) {
          // If a rejected Promise was yielded, throw the rejection back
          // into the async generator function so it can be handled there.
          return invoke("throw", error, resolve, reject);
        });
      }
    }

    var previousPromise;

    function enqueue(method, arg) {
      function callInvokeWithMethodAndArg() {
        return new PromiseImpl(function(resolve, reject) {
          invoke(method, arg, resolve, reject);
        });
      }

      return previousPromise =
        // If enqueue has been called before, then we want to wait until
        // all previous Promises have been resolved before calling invoke,
        // so that results are always delivered in the correct order. If
        // enqueue has not been called before, then it is important to
        // call invoke immediately, without waiting on a callback to fire,
        // so that the async generator function has the opportunity to do
        // any necessary setup in a predictable way. This predictability
        // is why the Promise constructor synchronously invokes its
        // executor callback, and why async functions synchronously
        // execute code before the first await. Since we implement simple
        // async functions in terms of async generators, it is especially
        // important to get this right, even though it requires care.
        previousPromise ? previousPromise.then(
          callInvokeWithMethodAndArg,
          // Avoid propagating failures to Promises returned by later
          // invocations of the iterator.
          callInvokeWithMethodAndArg
        ) : callInvokeWithMethodAndArg();
    }

    // Define the unified helper method that is used to implement .next,
    // .throw, and .return (see defineIteratorMethods).
    defineProperty(this, "_invoke", { value: enqueue });
  }

  defineIteratorMethods(AsyncIterator.prototype);
  define(AsyncIterator.prototype, asyncIteratorSymbol, function () {
    return this;
  });
  exports.AsyncIterator = AsyncIterator;

  // Note that simple async functions are implemented on top of
  // AsyncIterator objects; they just return a Promise for the value of
  // the final result produced by the iterator.
  exports.async = function(innerFn, outerFn, self, tryLocsList, PromiseImpl) {
    if (PromiseImpl === void 0) PromiseImpl = Promise;

    var iter = new AsyncIterator(
      wrap(innerFn, outerFn, self, tryLocsList),
      PromiseImpl
    );

    return exports.isGeneratorFunction(outerFn)
      ? iter // If outerFn is a generator, return the full iterator.
      : iter.next().then(function(result) {
          return result.done ? result.value : iter.next();
        });
  };

  function makeInvokeMethod(innerFn, self, context) {
    var state = GenStateSuspendedStart;

    return function invoke(method, arg) {
      if (state === GenStateExecuting) {
        throw new Error("Generator is already running");
      }

      if (state === GenStateCompleted) {
        if (method === "throw") {
          throw arg;
        }

        // Be forgiving, per GeneratorResume behavior specified since ES2015:
        // ES2015 spec, step 3: https://262.ecma-international.org/6.0/#sec-generatorresume
        // Latest spec, step 2: https://tc39.es/ecma262/#sec-generatorresume
        return doneResult();
      }

      context.method = method;
      context.arg = arg;

      while (true) {
        var delegate = context.delegate;
        if (delegate) {
          var delegateResult = maybeInvokeDelegate(delegate, context);
          if (delegateResult) {
            if (delegateResult === ContinueSentinel) continue;
            return delegateResult;
          }
        }

        if (context.method === "next") {
          // Setting context._sent for legacy support of Babel's
          // function.sent implementation.
          context.sent = context._sent = context.arg;

        } else if (context.method === "throw") {
          if (state === GenStateSuspendedStart) {
            state = GenStateCompleted;
            throw context.arg;
          }

          context.dispatchException(context.arg);

        } else if (context.method === "return") {
          context.abrupt("return", context.arg);
        }

        state = GenStateExecuting;

        var record = tryCatch(innerFn, self, context);
        if (record.type === "normal") {
          // If an exception is thrown from innerFn, we leave state ===
          // GenStateExecuting and loop back for another invocation.
          state = context.done
            ? GenStateCompleted
            : GenStateSuspendedYield;

          if (record.arg === ContinueSentinel) {
            continue;
          }

          return {
            value: record.arg,
            done: context.done
          };

        } else if (record.type === "throw") {
          state = GenStateCompleted;
          // Dispatch the exception by looping back around to the
          // context.dispatchException(context.arg) call above.
          context.method = "throw";
          context.arg = record.arg;
        }
      }
    };
  }

  // Call delegate.iterator[context.method](context.arg) and handle the
  // result, either by returning a { value, done } result from the
  // delegate iterator, or by modifying context.method and context.arg,
  // setting context.delegate to null, and returning the ContinueSentinel.
  function maybeInvokeDelegate(delegate, context) {
    var methodName = context.method;
    var method = delegate.iterator[methodName];
    if (method === undefined) {
      // A .throw or .return when the delegate iterator has no .throw
      // method, or a missing .next method, always terminate the
      // yield* loop.
      context.delegate = null;

      // Note: ["return"] must be used for ES3 parsing compatibility.
      if (methodName === "throw" && delegate.iterator["return"]) {
        // If the delegate iterator has a return method, give it a
        // chance to clean up.
        context.method = "return";
        context.arg = undefined;
        maybeInvokeDelegate(delegate, context);

        if (context.method === "throw") {
          // If maybeInvokeDelegate(context) changed context.method from
          // "return" to "throw", let that override the TypeError below.
          return ContinueSentinel;
        }
      }
      if (methodName !== "return") {
        context.method = "throw";
        context.arg = new TypeError(
          "The iterator does not provide a '" + methodName + "' method");
      }

      return ContinueSentinel;
    }

    var record = tryCatch(method, delegate.iterator, context.arg);

    if (record.type === "throw") {
      context.method = "throw";
      context.arg = record.arg;
      context.delegate = null;
      return ContinueSentinel;
    }

    var info = record.arg;

    if (! info) {
      context.method = "throw";
      context.arg = new TypeError("iterator result is not an object");
      context.delegate = null;
      return ContinueSentinel;
    }

    if (info.done) {
      // Assign the result of the finished delegate to the temporary
      // variable specified by delegate.resultName (see delegateYield).
      context[delegate.resultName] = info.value;

      // Resume execution at the desired location (see delegateYield).
      context.next = delegate.nextLoc;

      // If context.method was "throw" but the delegate handled the
      // exception, let the outer generator proceed normally. If
      // context.method was "next", forget context.arg since it has been
      // "consumed" by the delegate iterator. If context.method was
      // "return", allow the original .return call to continue in the
      // outer generator.
      if (context.method !== "return") {
        context.method = "next";
        context.arg = undefined;
      }

    } else {
      // Re-yield the result returned by the delegate method.
      return info;
    }

    // The delegate iterator is finished, so forget it and continue with
    // the outer generator.
    context.delegate = null;
    return ContinueSentinel;
  }

  // Define Generator.prototype.{next,throw,return} in terms of the
  // unified ._invoke helper method.
  defineIteratorMethods(Gp);

  define(Gp, toStringTagSymbol, "Generator");

  // A Generator should always return itself as the iterator object when the
  // @@iterator function is called on it. Some browsers' implementations of the
  // iterator prototype chain incorrectly implement this, causing the Generator
  // object to not be returned from this call. This ensures that doesn't happen.
  // See https://github.com/facebook/regenerator/issues/274 for more details.
  define(Gp, iteratorSymbol, function() {
    return this;
  });

  define(Gp, "toString", function() {
    return "[object Generator]";
  });

  function pushTryEntry(locs) {
    var entry = { tryLoc: locs[0] };

    if (1 in locs) {
      entry.catchLoc = locs[1];
    }

    if (2 in locs) {
      entry.finallyLoc = locs[2];
      entry.afterLoc = locs[3];
    }

    this.tryEntries.push(entry);
  }

  function resetTryEntry(entry) {
    var record = entry.completion || {};
    record.type = "normal";
    delete record.arg;
    entry.completion = record;
  }

  function Context(tryLocsList) {
    // The root entry object (effectively a try statement without a catch
    // or a finally block) gives us a place to store values thrown from
    // locations where there is no enclosing try statement.
    this.tryEntries = [{ tryLoc: "root" }];
    tryLocsList.forEach(pushTryEntry, this);
    this.reset(true);
  }

  exports.keys = function(val) {
    var object = Object(val);
    var keys = [];
    for (var key in object) {
      keys.push(key);
    }
    keys.reverse();

    // Rather than returning an object with a next method, we keep
    // things simple and return the next function itself.
    return function next() {
      while (keys.length) {
        var key = keys.pop();
        if (key in object) {
          next.value = key;
          next.done = false;
          return next;
        }
      }

      // To avoid creating an additional object, we just hang the .value
      // and .done properties off the next function object itself. This
      // also ensures that the minifier will not anonymize the function.
      next.done = true;
      return next;
    };
  };

  function values(iterable) {
    if (iterable != null) {
      var iteratorMethod = iterable[iteratorSymbol];
      if (iteratorMethod) {
        return iteratorMethod.call(iterable);
      }

      if (typeof iterable.next === "function") {
        return iterable;
      }

      if (!isNaN(iterable.length)) {
        var i = -1, next = function next() {
          while (++i < iterable.length) {
            if (hasOwn.call(iterable, i)) {
              next.value = iterable[i];
              next.done = false;
              return next;
            }
          }

          next.value = undefined;
          next.done = true;

          return next;
        };

        return next.next = next;
      }
    }

    throw new TypeError(typeof iterable + " is not iterable");
  }
  exports.values = values;

  function doneResult() {
    return { value: undefined, done: true };
  }

  Context.prototype = {
    constructor: Context,

    reset: function(skipTempReset) {
      this.prev = 0;
      this.next = 0;
      // Resetting context._sent for legacy support of Babel's
      // function.sent implementation.
      this.sent = this._sent = undefined;
      this.done = false;
      this.delegate = null;

      this.method = "next";
      this.arg = undefined;

      this.tryEntries.forEach(resetTryEntry);

      if (!skipTempReset) {
        for (var name in this) {
          // Not sure about the optimal order of these conditions:
          if (name.charAt(0) === "t" &&
              hasOwn.call(this, name) &&
              !isNaN(+name.slice(1))) {
            this[name] = undefined;
          }
        }
      }
    },

    stop: function() {
      this.done = true;

      var rootEntry = this.tryEntries[0];
      var rootRecord = rootEntry.completion;
      if (rootRecord.type === "throw") {
        throw rootRecord.arg;
      }

      return this.rval;
    },

    dispatchException: function(exception) {
      if (this.done) {
        throw exception;
      }

      var context = this;
      function handle(loc, caught) {
        record.type = "throw";
        record.arg = exception;
        context.next = loc;

        if (caught) {
          // If the dispatched exception was caught by a catch block,
          // then let that catch block handle the exception normally.
          context.method = "next";
          context.arg = undefined;
        }

        return !! caught;
      }

      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        var record = entry.completion;

        if (entry.tryLoc === "root") {
          // Exception thrown outside of any try block that could handle
          // it, so set the completion value of the entire function to
          // throw the exception.
          return handle("end");
        }

        if (entry.tryLoc <= this.prev) {
          var hasCatch = hasOwn.call(entry, "catchLoc");
          var hasFinally = hasOwn.call(entry, "finallyLoc");

          if (hasCatch && hasFinally) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            } else if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else if (hasCatch) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            }

          } else if (hasFinally) {
            if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else {
            throw new Error("try statement without catch or finally");
          }
        }
      }
    },

    abrupt: function(type, arg) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc <= this.prev &&
            hasOwn.call(entry, "finallyLoc") &&
            this.prev < entry.finallyLoc) {
          var finallyEntry = entry;
          break;
        }
      }

      if (finallyEntry &&
          (type === "break" ||
           type === "continue") &&
          finallyEntry.tryLoc <= arg &&
          arg <= finallyEntry.finallyLoc) {
        // Ignore the finally entry if control is not jumping to a
        // location outside the try/catch block.
        finallyEntry = null;
      }

      var record = finallyEntry ? finallyEntry.completion : {};
      record.type = type;
      record.arg = arg;

      if (finallyEntry) {
        this.method = "next";
        this.next = finallyEntry.finallyLoc;
        return ContinueSentinel;
      }

      return this.complete(record);
    },

    complete: function(record, afterLoc) {
      if (record.type === "throw") {
        throw record.arg;
      }

      if (record.type === "break" ||
          record.type === "continue") {
        this.next = record.arg;
      } else if (record.type === "return") {
        this.rval = this.arg = record.arg;
        this.method = "return";
        this.next = "end";
      } else if (record.type === "normal" && afterLoc) {
        this.next = afterLoc;
      }

      return ContinueSentinel;
    },

    finish: function(finallyLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.finallyLoc === finallyLoc) {
          this.complete(entry.completion, entry.afterLoc);
          resetTryEntry(entry);
          return ContinueSentinel;
        }
      }
    },

    "catch": function(tryLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc === tryLoc) {
          var record = entry.completion;
          if (record.type === "throw") {
            var thrown = record.arg;
            resetTryEntry(entry);
          }
          return thrown;
        }
      }

      // The context.catch method must only be called with a location
      // argument that corresponds to a known catch block.
      throw new Error("illegal catch attempt");
    },

    delegateYield: function(iterable, resultName, nextLoc) {
      this.delegate = {
        iterator: values(iterable),
        resultName: resultName,
        nextLoc: nextLoc
      };

      if (this.method === "next") {
        // Deliberately forget the last sent value so that we don't
        // accidentally pass it on to the delegate.
        this.arg = undefined;
      }

      return ContinueSentinel;
    }
  };

  // Regardless of whether this script is executing as a CommonJS module
  // or not, return the runtime object so that we can declare the variable
  // regeneratorRuntime in the outer scope, which allows this module to be
  // injected easily by `bin/regenerator --include-runtime script.js`.
  return exports;

}(
  // If this script is executing as a CommonJS module, use module.exports
  // as the regeneratorRuntime namespace. Otherwise create a new empty
  // object. Either way, the resulting object will be used to initialize
  // the regeneratorRuntime variable at the top of this file.
  typeof module === "object" ? module.exports : {}
));

try {
  regeneratorRuntime = runtime;
} catch (accidentalStrictMode) {
  // This module should not be running in strict mode, so the above
  // assignment should always work unless something is misconfigured. Just
  // in case runtime.js accidentally runs in strict mode, in modern engines
  // we can explicitly access globalThis. In older engines we can escape
  // strict mode using a global Function call. This could conceivably fail
  // if a Content Security Policy forbids using Function, but in that case
  // the proper solution is to fix the accidental strict mode problem. If
  // you've misconfigured your bundler to force strict mode and applied a
  // CSP to forbid Function, and you're not willing to fix either of those
  // problems, please detail your unique predicament in a GitHub issue.
  if (typeof globalThis === "object") {
    globalThis.regeneratorRuntime = runtime;
  } else {
    Function("r", "regeneratorRuntime = r")(runtime);
  }
}

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (factory((global.WHATWGFetch = {})));
}(this, (function (exports) { 'use strict';

  /* eslint-disable no-prototype-builtins */
  var g =
    (typeof globalThis !== 'undefined' && globalThis) ||
    (typeof self !== 'undefined' && self) ||
    // eslint-disable-next-line no-undef
    (typeof global !== 'undefined' && global) ||
    {};

  var support = {
    searchParams: 'URLSearchParams' in g,
    iterable: 'Symbol' in g && 'iterator' in Symbol,
    blob:
      'FileReader' in g &&
      'Blob' in g &&
      (function() {
        try {
          new Blob();
          return true
        } catch (e) {
          return false
        }
      })(),
    formData: 'FormData' in g,
    arrayBuffer: 'ArrayBuffer' in g
  };

  function isDataView(obj) {
    return obj && DataView.prototype.isPrototypeOf(obj)
  }

  if (support.arrayBuffer) {
    var viewClasses = [
      '[object Int8Array]',
      '[object Uint8Array]',
      '[object Uint8ClampedArray]',
      '[object Int16Array]',
      '[object Uint16Array]',
      '[object Int32Array]',
      '[object Uint32Array]',
      '[object Float32Array]',
      '[object Float64Array]'
    ];

    var isArrayBufferView =
      ArrayBuffer.isView ||
      function(obj) {
        return obj && viewClasses.indexOf(Object.prototype.toString.call(obj)) > -1
      };
  }

  function normalizeName(name) {
    if (typeof name !== 'string') {
      name = String(name);
    }
    if (/[^a-z0-9\-#$%&'*+.^_`|~!]/i.test(name) || name === '') {
      throw new TypeError('Invalid character in header field name: "' + name + '"')
    }
    return name.toLowerCase()
  }

  function normalizeValue(value) {
    if (typeof value !== 'string') {
      value = String(value);
    }
    return value
  }

  // Build a destructive iterator for the value list
  function iteratorFor(items) {
    var iterator = {
      next: function() {
        var value = items.shift();
        return {done: value === undefined, value: value}
      }
    };

    if (support.iterable) {
      iterator[Symbol.iterator] = function() {
        return iterator
      };
    }

    return iterator
  }

  function Headers(headers) {
    this.map = {};

    if (headers instanceof Headers) {
      headers.forEach(function(value, name) {
        this.append(name, value);
      }, this);
    } else if (Array.isArray(headers)) {
      headers.forEach(function(header) {
        if (header.length != 2) {
          throw new TypeError('Headers constructor: expected name/value pair to be length 2, found' + header.length)
        }
        this.append(header[0], header[1]);
      }, this);
    } else if (headers) {
      Object.getOwnPropertyNames(headers).forEach(function(name) {
        this.append(name, headers[name]);
      }, this);
    }
  }

  Headers.prototype.append = function(name, value) {
    name = normalizeName(name);
    value = normalizeValue(value);
    var oldValue = this.map[name];
    this.map[name] = oldValue ? oldValue + ', ' + value : value;
  };

  Headers.prototype['delete'] = function(name) {
    delete this.map[normalizeName(name)];
  };

  Headers.prototype.get = function(name) {
    name = normalizeName(name);
    return this.has(name) ? this.map[name] : null
  };

  Headers.prototype.has = function(name) {
    return this.map.hasOwnProperty(normalizeName(name))
  };

  Headers.prototype.set = function(name, value) {
    this.map[normalizeName(name)] = normalizeValue(value);
  };

  Headers.prototype.forEach = function(callback, thisArg) {
    for (var name in this.map) {
      if (this.map.hasOwnProperty(name)) {
        callback.call(thisArg, this.map[name], name, this);
      }
    }
  };

  Headers.prototype.keys = function() {
    var items = [];
    this.forEach(function(value, name) {
      items.push(name);
    });
    return iteratorFor(items)
  };

  Headers.prototype.values = function() {
    var items = [];
    this.forEach(function(value) {
      items.push(value);
    });
    return iteratorFor(items)
  };

  Headers.prototype.entries = function() {
    var items = [];
    this.forEach(function(value, name) {
      items.push([name, value]);
    });
    return iteratorFor(items)
  };

  if (support.iterable) {
    Headers.prototype[Symbol.iterator] = Headers.prototype.entries;
  }

  function consumed(body) {
    if (body._noBody) return
    if (body.bodyUsed) {
      return Promise.reject(new TypeError('Already read'))
    }
    body.bodyUsed = true;
  }

  function fileReaderReady(reader) {
    return new Promise(function(resolve, reject) {
      reader.onload = function() {
        resolve(reader.result);
      };
      reader.onerror = function() {
        reject(reader.error);
      };
    })
  }

  function readBlobAsArrayBuffer(blob) {
    var reader = new FileReader();
    var promise = fileReaderReady(reader);
    reader.readAsArrayBuffer(blob);
    return promise
  }

  function readBlobAsText(blob) {
    var reader = new FileReader();
    var promise = fileReaderReady(reader);
    var match = /charset=([A-Za-z0-9_-]+)/.exec(blob.type);
    var encoding = match ? match[1] : 'utf-8';
    reader.readAsText(blob, encoding);
    return promise
  }

  function readArrayBufferAsText(buf) {
    var view = new Uint8Array(buf);
    var chars = new Array(view.length);

    for (var i = 0; i < view.length; i++) {
      chars[i] = String.fromCharCode(view[i]);
    }
    return chars.join('')
  }

  function bufferClone(buf) {
    if (buf.slice) {
      return buf.slice(0)
    } else {
      var view = new Uint8Array(buf.byteLength);
      view.set(new Uint8Array(buf));
      return view.buffer
    }
  }

  function Body() {
    this.bodyUsed = false;

    this._initBody = function(body) {
      /*
        fetch-mock wraps the Response object in an ES6 Proxy to
        provide useful test harness features such as flush. However, on
        ES5 browsers without fetch or Proxy support pollyfills must be used;
        the proxy-pollyfill is unable to proxy an attribute unless it exists
        on the object before the Proxy is created. This change ensures
        Response.bodyUsed exists on the instance, while maintaining the
        semantic of setting Request.bodyUsed in the constructor before
        _initBody is called.
      */
      // eslint-disable-next-line no-self-assign
      this.bodyUsed = this.bodyUsed;
      this._bodyInit = body;
      if (!body) {
        this._noBody = true;
        this._bodyText = '';
      } else if (typeof body === 'string') {
        this._bodyText = body;
      } else if (support.blob && Blob.prototype.isPrototypeOf(body)) {
        this._bodyBlob = body;
      } else if (support.formData && FormData.prototype.isPrototypeOf(body)) {
        this._bodyFormData = body;
      } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
        this._bodyText = body.toString();
      } else if (support.arrayBuffer && support.blob && isDataView(body)) {
        this._bodyArrayBuffer = bufferClone(body.buffer);
        // IE 10-11 can't handle a DataView body.
        this._bodyInit = new Blob([this._bodyArrayBuffer]);
      } else if (support.arrayBuffer && (ArrayBuffer.prototype.isPrototypeOf(body) || isArrayBufferView(body))) {
        this._bodyArrayBuffer = bufferClone(body);
      } else {
        this._bodyText = body = Object.prototype.toString.call(body);
      }

      if (!this.headers.get('content-type')) {
        if (typeof body === 'string') {
          this.headers.set('content-type', 'text/plain;charset=UTF-8');
        } else if (this._bodyBlob && this._bodyBlob.type) {
          this.headers.set('content-type', this._bodyBlob.type);
        } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
          this.headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
        }
      }
    };

    if (support.blob) {
      this.blob = function() {
        var rejected = consumed(this);
        if (rejected) {
          return rejected
        }

        if (this._bodyBlob) {
          return Promise.resolve(this._bodyBlob)
        } else if (this._bodyArrayBuffer) {
          return Promise.resolve(new Blob([this._bodyArrayBuffer]))
        } else if (this._bodyFormData) {
          throw new Error('could not read FormData body as blob')
        } else {
          return Promise.resolve(new Blob([this._bodyText]))
        }
      };
    }

    this.arrayBuffer = function() {
      if (this._bodyArrayBuffer) {
        var isConsumed = consumed(this);
        if (isConsumed) {
          return isConsumed
        } else if (ArrayBuffer.isView(this._bodyArrayBuffer)) {
          return Promise.resolve(
            this._bodyArrayBuffer.buffer.slice(
              this._bodyArrayBuffer.byteOffset,
              this._bodyArrayBuffer.byteOffset + this._bodyArrayBuffer.byteLength
            )
          )
        } else {
          return Promise.resolve(this._bodyArrayBuffer)
        }
      } else if (support.blob) {
        return this.blob().then(readBlobAsArrayBuffer)
      } else {
        throw new Error('could not read as ArrayBuffer')
      }
    };

    this.text = function() {
      var rejected = consumed(this);
      if (rejected) {
        return rejected
      }

      if (this._bodyBlob) {
        return readBlobAsText(this._bodyBlob)
      } else if (this._bodyArrayBuffer) {
        return Promise.resolve(readArrayBufferAsText(this._bodyArrayBuffer))
      } else if (this._bodyFormData) {
        throw new Error('could not read FormData body as text')
      } else {
        return Promise.resolve(this._bodyText)
      }
    };

    if (support.formData) {
      this.formData = function() {
        return this.text().then(decode)
      };
    }

    this.json = function() {
      return this.text().then(JSON.parse)
    };

    return this
  }

  // HTTP methods whose capitalization should be normalized
  var methods = ['CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE'];

  function normalizeMethod(method) {
    var upcased = method.toUpperCase();
    return methods.indexOf(upcased) > -1 ? upcased : method
  }

  function Request(input, options) {
    if (!(this instanceof Request)) {
      throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.')
    }

    options = options || {};
    var body = options.body;

    if (input instanceof Request) {
      if (input.bodyUsed) {
        throw new TypeError('Already read')
      }
      this.url = input.url;
      this.credentials = input.credentials;
      if (!options.headers) {
        this.headers = new Headers(input.headers);
      }
      this.method = input.method;
      this.mode = input.mode;
      this.signal = input.signal;
      if (!body && input._bodyInit != null) {
        body = input._bodyInit;
        input.bodyUsed = true;
      }
    } else {
      this.url = String(input);
    }

    this.credentials = options.credentials || this.credentials || 'same-origin';
    if (options.headers || !this.headers) {
      this.headers = new Headers(options.headers);
    }
    this.method = normalizeMethod(options.method || this.method || 'GET');
    this.mode = options.mode || this.mode || null;
    this.signal = options.signal || this.signal || (function () {
      if ('AbortController' in g) {
        var ctrl = new AbortController();
        return ctrl.signal;
      }
    }());
    this.referrer = null;

    if ((this.method === 'GET' || this.method === 'HEAD') && body) {
      throw new TypeError('Body not allowed for GET or HEAD requests')
    }
    this._initBody(body);

    if (this.method === 'GET' || this.method === 'HEAD') {
      if (options.cache === 'no-store' || options.cache === 'no-cache') {
        // Search for a '_' parameter in the query string
        var reParamSearch = /([?&])_=[^&]*/;
        if (reParamSearch.test(this.url)) {
          // If it already exists then set the value with the current time
          this.url = this.url.replace(reParamSearch, '$1_=' + new Date().getTime());
        } else {
          // Otherwise add a new '_' parameter to the end with the current time
          var reQueryString = /\?/;
          this.url += (reQueryString.test(this.url) ? '&' : '?') + '_=' + new Date().getTime();
        }
      }
    }
  }

  Request.prototype.clone = function() {
    return new Request(this, {body: this._bodyInit})
  };

  function decode(body) {
    var form = new FormData();
    body
      .trim()
      .split('&')
      .forEach(function(bytes) {
        if (bytes) {
          var split = bytes.split('=');
          var name = split.shift().replace(/\+/g, ' ');
          var value = split.join('=').replace(/\+/g, ' ');
          form.append(decodeURIComponent(name), decodeURIComponent(value));
        }
      });
    return form
  }

  function parseHeaders(rawHeaders) {
    var headers = new Headers();
    // Replace instances of \r\n and \n followed by at least one space or horizontal tab with a space
    // https://tools.ietf.org/html/rfc7230#section-3.2
    var preProcessedHeaders = rawHeaders.replace(/\r?\n[\t ]+/g, ' ');
    // Avoiding split via regex to work around a common IE11 bug with the core-js 3.6.0 regex polyfill
    // https://github.com/github/fetch/issues/748
    // https://github.com/zloirock/core-js/issues/751
    preProcessedHeaders
      .split('\r')
      .map(function(header) {
        return header.indexOf('\n') === 0 ? header.substr(1, header.length) : header
      })
      .forEach(function(line) {
        var parts = line.split(':');
        var key = parts.shift().trim();
        if (key) {
          var value = parts.join(':').trim();
          try {
            headers.append(key, value);
          } catch (error) {
            console.warn('Response ' + error.message);
          }
        }
      });
    return headers
  }

  Body.call(Request.prototype);

  function Response(bodyInit, options) {
    if (!(this instanceof Response)) {
      throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.')
    }
    if (!options) {
      options = {};
    }

    this.type = 'default';
    this.status = options.status === undefined ? 200 : options.status;
    if (this.status < 200 || this.status > 599) {
      throw new RangeError("Failed to construct 'Response': The status provided (0) is outside the range [200, 599].")
    }
    this.ok = this.status >= 200 && this.status < 300;
    this.statusText = options.statusText === undefined ? '' : '' + options.statusText;
    this.headers = new Headers(options.headers);
    this.url = options.url || '';
    this._initBody(bodyInit);
  }

  Body.call(Response.prototype);

  Response.prototype.clone = function() {
    return new Response(this._bodyInit, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
      url: this.url
    })
  };

  Response.error = function() {
    var response = new Response(null, {status: 200, statusText: ''});
    response.ok = false;
    response.status = 0;
    response.type = 'error';
    return response
  };

  var redirectStatuses = [301, 302, 303, 307, 308];

  Response.redirect = function(url, status) {
    if (redirectStatuses.indexOf(status) === -1) {
      throw new RangeError('Invalid status code')
    }

    return new Response(null, {status: status, headers: {location: url}})
  };

  exports.DOMException = g.DOMException;
  try {
    new exports.DOMException();
  } catch (err) {
    exports.DOMException = function(message, name) {
      this.message = message;
      this.name = name;
      var error = Error(message);
      this.stack = error.stack;
    };
    exports.DOMException.prototype = Object.create(Error.prototype);
    exports.DOMException.prototype.constructor = exports.DOMException;
  }

  function fetch(input, init) {
    return new Promise(function(resolve, reject) {
      var request = new Request(input, init);

      if (request.signal && request.signal.aborted) {
        return reject(new exports.DOMException('Aborted', 'AbortError'))
      }

      var xhr = new XMLHttpRequest();

      function abortXhr() {
        xhr.abort();
      }

      xhr.onload = function() {
        var options = {
          statusText: xhr.statusText,
          headers: parseHeaders(xhr.getAllResponseHeaders() || '')
        };
        // This check if specifically for when a user fetches a file locally from the file system
        // Only if the status is out of a normal range
        if (request.url.indexOf('file://') === 0 && (xhr.status < 200 || xhr.status > 599)) {
          options.status = 200;
        } else {
          options.status = xhr.status;
        }
        options.url = 'responseURL' in xhr ? xhr.responseURL : options.headers.get('X-Request-URL');
        var body = 'response' in xhr ? xhr.response : xhr.responseText;
        setTimeout(function() {
          resolve(new Response(body, options));
        }, 0);
      };

      xhr.onerror = function() {
        setTimeout(function() {
          reject(new TypeError('Network request failed'));
        }, 0);
      };

      xhr.ontimeout = function() {
        setTimeout(function() {
          reject(new TypeError('Network request timed out'));
        }, 0);
      };

      xhr.onabort = function() {
        setTimeout(function() {
          reject(new exports.DOMException('Aborted', 'AbortError'));
        }, 0);
      };

      function fixUrl(url) {
        try {
          return url === '' && g.location.href ? g.location.href : url
        } catch (e) {
          return url
        }
      }

      xhr.open(request.method, fixUrl(request.url), true);

      if (request.credentials === 'include') {
        xhr.withCredentials = true;
      } else if (request.credentials === 'omit') {
        xhr.withCredentials = false;
      }

      if ('responseType' in xhr) {
        if (support.blob) {
          xhr.responseType = 'blob';
        } else if (
          support.arrayBuffer
        ) {
          xhr.responseType = 'arraybuffer';
        }
      }

      if (init && typeof init.headers === 'object' && !(init.headers instanceof Headers || (g.Headers && init.headers instanceof g.Headers))) {
        var names = [];
        Object.getOwnPropertyNames(init.headers).forEach(function(name) {
          names.push(normalizeName(name));
          xhr.setRequestHeader(name, normalizeValue(init.headers[name]));
        });
        request.headers.forEach(function(value, name) {
          if (names.indexOf(name) === -1) {
            xhr.setRequestHeader(name, value);
          }
        });
      } else {
        request.headers.forEach(function(value, name) {
          xhr.setRequestHeader(name, value);
        });
      }

      if (request.signal) {
        request.signal.addEventListener('abort', abortXhr);

        xhr.onreadystatechange = function() {
          // DONE (success or failure)
          if (xhr.readyState === 4) {
            request.signal.removeEventListener('abort', abortXhr);
          }
        };
      }

      xhr.send(typeof request._bodyInit === 'undefined' ? null : request._bodyInit);
    })
  }

  fetch.polyfill = true;

  if (!g.fetch) {
    g.fetch = fetch;
    g.Headers = Headers;
    g.Request = Request;
    g.Response = Response;
  }

  exports.Headers = Headers;
  exports.Request = Request;
  exports.Response = Response;
  exports.fetch = fetch;

  Object.defineProperty(exports, '__esModule', { value: true });

})));

function _regenerator() { /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag"; function i(r, n, o, i) { var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype); return _regeneratorDefine2(u, "_invoke", function (r, n, o) { var i, c, u, f = 0, p = o || [], y = !1, G = { p: 0, n: 0, v: e, a: d, f: d.bind(e, 4), d: function d(t, r) { return i = t, c = 0, u = e, G.n = r, a; } }; function d(r, n) { for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) { var o, i = p[t], d = G.p, l = i[2]; r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0)); } if (o || r > 1) return a; throw y = !0, n; } return function (o, p, l) { if (f > 1) throw TypeError("Generator is already running"); for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) { i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u); try { if (f = 2, i) { if (c || (o = "next"), t = i[o]) { if (!(t = t.call(i, u))) throw TypeError("iterator result is not an object"); if (!t.done) return t; u = t.value, c < 2 && (c = 0); } else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError("The iterator does not provide a '" + o + "' method"), c = 1); i = e; } else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break; } catch (t) { i = e, c = 1, u = t; } finally { f = 1; } } return { value: t, done: y }; }; }(r, o, i), !0), u; } var a = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} t = Object.getPrototypeOf; var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function () { return this; }), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c); function f(e) { return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, "GeneratorFunction")), e.prototype = Object.create(u), e; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, o, "GeneratorFunction"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, "Generator"), _regeneratorDefine2(u, n, function () { return this; }), _regeneratorDefine2(u, "toString", function () { return "[object Generator]"; }), (_regenerator = function _regenerator() { return { w: i, m: f }; })(); }
function _regeneratorDefine2(e, r, n, t) { var i = Object.defineProperty; try { i({}, "", {}); } catch (e) { i = 0; } _regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) { function o(r, n) { _regeneratorDefine2(e, r, function (e) { return this._invoke(r, n, e); }); } r ? i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2)); }, _regeneratorDefine2(e, r, n, t); }
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }
/* ===== Morning Board — renderer + rotation ===== */

var ROTATE_MS = 20000; // 20s per card
var RELOAD_MS = 30 * 60000; // re-fetch data.json every 30 min

var stage = document.getElementById("stage");
var dotsNav = document.getElementById("dots");
var cards = []; // [{kind, el}]
var current = 0;
var rotateTimer = null;

/* ---------- helpers ---------- */

var esc = function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c];
  });
};
var cToF = function cToF(c) {
  return c * 9 / 5 + 32;
};
var WEEKDAY_NAMES_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTH_NAMES_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "Thursday, July 24" — avoids Date.prototype.toLocaleDateString(options),
// whose weekday/month-name support is unreliable on old WebKit.
function formatLongDate(date) {
  return `${WEEKDAY_NAMES_LONG[date.getDay()]}, ${MONTH_NAMES_LONG[date.getMonth()]} ${date.getDate()}`;
}

// "12,345.6" — avoids Number.prototype.toLocaleString(options), which old
// Safari either ignores or only partially honors.
function formatNumber(n, maxFractionDigits) {
  var fixed = Number(n).toFixed(maxFractionDigits);
  var trimmed = fixed.indexOf(".") === -1 ? fixed : fixed.replace(/0+$/, "").replace(/\.$/, "");
  var _trimmed$split = trimmed.split("."),
    _trimmed$split2 = _slicedToArray(_trimmed$split, 2),
    intPart = _trimmed$split2[0],
    fracPart = _trimmed$split2[1];
  var withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${withCommas}.${fracPart}` : withCommas;
}

/* ---------- ink-painting creature SVGs ---------- */
// Style: silhouette-forward ink brush look, warm-ink tones, soft washes.
// Subjects chosen to be uncommon in the classical tradition (no koi / crane /
// tiger / plum / bamboo / lotus).

var CREATURES = {
  // Sun + wispy ink cloud — main weather illustration
  inkSun: `<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg">
    <circle cx="82" cy="66" r="42" fill="#c96a52" opacity="0.85"/>
    <circle cx="82" cy="66" r="42" fill="none" stroke="#3f382f" stroke-width="2.5"/>
    <path d="M38 132 Q26 118 46 108 Q54 86 92 96 Q104 74 138 92 Q170 82 190 108 Q214 108 208 134 Q198 150 168 150 L62 150 Q36 150 38 132 Z"
      fill="#ebe2d0" stroke="#3f382f" stroke-width="2.8" stroke-linejoin="round"/>
    <path d="M75 132 Q100 124 130 130 Q160 124 178 132" fill="none" stroke="#3f382f" stroke-width="1.4" opacity="0.45" stroke-linecap="round"/>
    <path d="M55 142 Q80 136 105 142" fill="none" stroke="#3f382f" stroke-width="1.2" opacity="0.35" stroke-linecap="round"/>
  </svg>`,
  // Swallow (燕) — flying, forked tail
  swallow: `<svg viewBox="0 0 190 130" xmlns="http://www.w3.org/2000/svg">
    <path d="M25 66
             Q45 44 84 58
             Q102 42 152 22
             Q128 42 130 62
             Q138 68 162 70
             Q178 80 182 104
             Q154 90 128 84
             Q112 94 92 92
             Q68 94 40 80
             Q28 72 25 66 Z"
      fill="#3f382f"/>
    <path d="M45 70 Q76 64 102 74 Q80 80 55 76 Z" fill="#f6efdc" opacity="0.55"/>
    <circle cx="38" cy="64" r="1.7" fill="#f6efdc"/>
    <path d="M158 30 Q170 42 178 24" fill="none" stroke="#3f382f" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,
  // Squirrel (松鼠) — sitting, big curled tail, holding a nut
  squirrel: `<svg viewBox="0 0 175 185" xmlns="http://www.w3.org/2000/svg">
    <path d="M95 132 Q142 118 148 66 Q145 22 100 22 Q76 26 82 56"
      fill="none" stroke="#6b5a48" stroke-width="30" stroke-linecap="round"/>
    <path d="M95 132 Q142 118 148 66 Q145 22 100 22 Q76 26 82 56"
      fill="none" stroke="#a89078" stroke-width="14" stroke-linecap="round" opacity="0.5"/>
    <ellipse cx="60" cy="118" rx="34" ry="46" fill="#6b5a48"/>
    <ellipse cx="55" cy="128" rx="18" ry="28" fill="#f0e2c6" opacity="0.55"/>
    <circle cx="46" cy="72" r="26" fill="#6b5a48"/>
    <path d="M30 55 L28 40 L42 52 Z" fill="#6b5a48"/>
    <path d="M62 55 L64 40 L50 52 Z" fill="#6b5a48"/>
    <path d="M32 50 L34 45 L38 50 Z" fill="#a3624a" opacity="0.6"/>
    <path d="M58 50 L60 45 L54 50 Z" fill="#a3624a" opacity="0.6"/>
    <circle cx="39" cy="74" r="2.4" fill="#3f382f"/>
    <path d="M20 82 Q26 84 30 82 Q28 87 24 87 Z" fill="#3f382f"/>
    <ellipse cx="50" cy="152" rx="10" ry="6" fill="#6b5a48"/>
    <ellipse cx="50" cy="142" rx="7" ry="9" fill="#a3624a"/>
    <path d="M44 135 Q50 130 56 135" stroke="#3f382f" stroke-width="1.4" fill="none"/>
  </svg>`,
  // Hedgehog (刺猬) — round with spike strokes, peeking face
  hedgehog: `<svg viewBox="0 0 195 140" xmlns="http://www.w3.org/2000/svg">
    <g stroke="#3f382f" stroke-width="2.5" stroke-linecap="round" fill="none">
      <line x1="55" y1="55" x2="48" y2="30"/>
      <line x1="72" y1="42" x2="70" y2="18"/>
      <line x1="92" y1="38" x2="94" y2="14"/>
      <line x1="112" y1="42" x2="118" y2="18"/>
      <line x1="132" y1="52" x2="142" y2="28"/>
      <line x1="150" y1="65" x2="168" y2="52"/>
      <line x1="162" y1="82" x2="182" y2="80"/>
      <line x1="160" y1="98" x2="178" y2="108"/>
    </g>
    <path d="M50 100 Q45 55 100 55 Q160 55 160 100 Q157 122 100 122 Q52 122 50 100 Z"
      fill="#6b5a48"/>
    <g stroke="#3f382f" stroke-width="1.4" opacity="0.4" fill="none">
      <path d="M60 65 L55 55"/>
      <path d="M75 60 L72 50"/>
      <path d="M90 58 L88 46"/>
      <path d="M110 60 L114 48"/>
      <path d="M128 65 L134 52"/>
      <path d="M144 78 L154 68"/>
    </g>
    <ellipse cx="95" cy="115" rx="45" ry="10" fill="#f0e2c6" opacity="0.35"/>
    <path d="M50 96 Q30 96 22 106 Q22 118 38 120 Q52 120 55 108 Z"
      fill="#e8dcc0" stroke="#3f382f" stroke-width="1.6"/>
    <ellipse cx="23" cy="108" rx="3" ry="2.4" fill="#3f382f"/>
    <circle cx="42" cy="102" r="1.8" fill="#3f382f"/>
    <ellipse cx="72" cy="125" rx="7" ry="3" fill="#3f382f"/>
    <ellipse cx="128" cy="125" rx="7" ry="3" fill="#3f382f"/>
  </svg>`,
  // Bat (蝠 → 福) — cheerful, spread wings
  bat: `<svg viewBox="0 0 210 140" xmlns="http://www.w3.org/2000/svg">
    <path d="M105 70 Q68 30 22 42 Q36 56 28 80 Q46 84 56 74 Q66 86 84 78 Q94 84 105 80 Z"
      fill="#7a5a4a"/>
    <path d="M105 70 Q142 30 188 42 Q174 56 182 80 Q164 84 154 74 Q144 86 126 78 Q116 84 105 80 Z"
      fill="#7a5a4a"/>
    <g stroke="#3f382f" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.55">
      <path d="M105 72 Q75 52 40 54"/>
      <path d="M105 74 Q86 62 58 74"/>
      <path d="M105 74 Q96 76 84 80"/>
      <path d="M105 72 Q135 52 170 54"/>
      <path d="M105 74 Q124 62 152 74"/>
      <path d="M105 74 Q114 76 126 80"/>
    </g>
    <ellipse cx="105" cy="82" rx="15" ry="22" fill="#5a4a3a"/>
    <circle cx="105" cy="60" r="17" fill="#5a4a3a"/>
    <path d="M93 46 L91 30 L103 44 Z" fill="#5a4a3a"/>
    <path d="M117 46 L119 30 L107 44 Z" fill="#5a4a3a"/>
    <path d="M95 60 Q100 55 105 60" stroke="#f6efdc" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M105 60 Q110 55 115 60" stroke="#f6efdc" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M99 68 Q105 72 111 68" stroke="#f6efdc" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`,
  // Small wispy ink cloud (secondary accent)
  inkCloud: `<svg viewBox="0 0 140 60" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 40 Q12 40 12 30 Q12 20 24 20 Q28 12 44 12 Q60 8 70 22 Q88 20 92 32 Q106 32 105 42 Q102 50 92 50 L32 50 Q20 50 20 40 Z"
      fill="none" stroke="#3f382f" stroke-width="2.2" stroke-linejoin="round" opacity="0.6"/>
    <path d="M32 45 Q50 42 68 45" fill="none" stroke="#3f382f" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/>
  </svg>`,
  // Ink leaf (ginkgo-ish) — small accent
  inkLeaf: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 20 Q22 40 20 78 Q22 100 50 105 Q78 100 80 78 Q78 40 50 20 Z"
      fill="#8b9b70" opacity="0.65"/>
    <path d="M50 20 Q22 40 20 78 Q22 100 50 105 Q78 100 80 78 Q78 40 50 20 Z"
      fill="none" stroke="#3f382f" stroke-width="1.8"/>
    <path d="M50 20 L50 105" stroke="#3f382f" stroke-width="1.2" opacity="0.5"/>
    <path d="M50 55 Q35 68 30 82" fill="none" stroke="#3f382f" stroke-width="1" opacity="0.4"/>
    <path d="M50 55 Q65 68 70 82" fill="none" stroke="#3f382f" stroke-width="1" opacity="0.4"/>
    <line x1="50" y1="105" x2="50" y2="122" stroke="#3f382f" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  // Cinnabar seal (印章) — traditional finishing mark
  seal: `<svg viewBox="0 0 80 90" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="68" height="78" rx="3" fill="#c15a3e" stroke="#3f382f" stroke-width="1.5"/>
    <rect x="12" y="12" width="56" height="66" rx="2" fill="none" stroke="#f6efdc" stroke-width="1.4"/>
    <g stroke="#f6efdc" stroke-width="3" stroke-linecap="square" fill="none">
      <path d="M22 25 L58 25"/>
      <path d="M22 42 L58 42"/>
      <path d="M32 25 L32 42"/>
      <path d="M48 25 L48 42"/>
      <path d="M22 55 L58 55"/>
      <path d="M40 55 L40 70"/>
      <path d="M22 70 L58 70"/>
    </g>
  </svg>`
};
var DECOS = {
  weather: [{
    pos: "tr",
    key: "swallow",
    size: "m"
  }, {
    pos: "bl",
    key: "inkCloud",
    size: "s"
  }],
  hotTopics: [{
    pos: "tl",
    key: "squirrel",
    size: "l"
  }, {
    pos: "br",
    key: "inkLeaf",
    size: "s"
  }],
  market: [{
    pos: "bl",
    key: "hedgehog",
    size: "l"
  }, {
    pos: "tr",
    key: "seal",
    size: "xs"
  }],
  joke: [{
    pos: "tl",
    key: "bat",
    size: "m"
  }, {
    pos: "br",
    key: "seal",
    size: "xs"
  }],
  famousPeople: [{
    pos: "tr",
    key: "inkLeaf",
    size: "s"
  }, {
    pos: "bl",
    key: "seal",
    size: "xs"
  }]
};
function decorations(kind) {
  return (DECOS[kind] || []).map(function (d) {
    return `<div class="deco deco--${d.pos} deco--${d.size}">${CREATURES[d.key]}</div>`;
  }).join("");
}

// nth Sunday of a UTC month (0=Jan), 1-based n; last=true finds the last Sunday instead
function nthSundayUTC(year, monthIdx, n, last) {
  var d = last ? new Date(Date.UTC(year, monthIdx + 1, 0)) // last day of month
  : new Date(Date.UTC(year, monthIdx, 1));
  var day = d.getUTCDay(); // 0 = Sunday
  if (last) {
    d.setUTCDate(d.getUTCDate() - day);
  } else {
    var offset = (7 - day) % 7;
    d.setUTCDate(1 + offset + (n - 1) * 7);
  }
  return d;
}

// Fixed-rule DST windows so timezone math needs no Intl/ICU data at all
var DST_RULES = {
  US: {
    // 2nd Sunday March -> 1st Sunday November
    start: function start(y) {
      return nthSundayUTC(y, 2, 2, false);
    },
    end: function end(y) {
      return nthSundayUTC(y, 10, 1, false);
    },
    stdOffsetMin: -5 * 60,
    dstOffsetMin: -4 * 60
  },
  Europe: {
    // last Sunday March -> last Sunday October
    start: function start(y) {
      return nthSundayUTC(y, 2, 1, true);
    },
    end: function end(y) {
      return nthSundayUTC(y, 9, 1, true);
    },
    stdOffsetMin: 1 * 60,
    dstOffsetMin: 2 * 60
  }
};

// Get {hour, minute, weekday} right now in a given zone key. Self-contained —
// avoids Intl.DateTimeFormat().formatToParts(), which iOS 9 Safari either lacks
// or throws on for non-UTC timeZone values.
function nowInZone(zoneKey) {
  var now = new Date();
  var offsetMin;
  if (zoneKey === "Asia/Shanghai") {
    offsetMin = 8 * 60; // fixed, no DST
  } else {
    var rule = zoneKey === "America/New_York" ? DST_RULES.US : DST_RULES.Europe;
    var year = now.getUTCFullYear();
    var inDst = now >= rule.start(year) && now < rule.end(year);
    offsetMin = inDst ? rule.dstOffsetMin : rule.stdOffsetMin;
  }
  var local = new Date(now.getTime() + offsetMin * 60000);
  var weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: weekdayNames[local.getUTCDay()]
  };
}

// Exchange trading hours per region (local exchange time)
var MARKET_HOURS = {
  US: {
    tz: "America/New_York",
    open: [9, 30],
    close: [16, 0]
  },
  Europe: {
    tz: "Europe/Berlin",
    open: [9, 0],
    close: [17, 30]
  },
  Asia: {
    tz: "Asia/Shanghai",
    open: [9, 30],
    close: [16, 0]
  }
};
function isMarketOpen(region) {
  var cfg = MARKET_HOURS[region];
  if (!cfg) return false;
  var _nowInZone = nowInZone(cfg.tz),
    hour = _nowInZone.hour,
    minute = _nowInZone.minute,
    weekday = _nowInZone.weekday;
  if (weekday === "Sat" || weekday === "Sun") return false;
  var mins = hour * 60 + minute;
  var openMins = cfg.open[0] * 60 + cfg.open[1];
  var closeMins = cfg.close[0] * 60 + cfg.close[1];
  return mins >= openMins && mins < closeMins;
}

/* ---------- card builders (return HTML strings) ---------- */

function buildWeather(w) {
  var now = new Date();
  var dateStr = formatLongDate(now);
  return `
    <div class="card-title">${esc(dateStr)} · ${esc(w.location || "Weather")}</div>
    <div class="weather-row">
      <div class="weather-icon">${CREATURES.inkSun}</div>
      <div class="weather-main">
        <div class="weather-temp">${Math.round(w.lowC)}°<span class="weather-temp-sep">–</span>${Math.round(w.highC)}<sup>°C</sup></div>
        <div class="weather-temp-alt">${Math.round(cToF(w.lowC))}°–${Math.round(cToF(w.highC))}<sup>°F</sup></div>
        <div class="weather-cond">${esc(w.condition || "")}</div>
      </div>
    </div>
    <div class="weather-meta">
      <span><b>Now</b> ${Math.round(w.tempC)}°C · ${Math.round(cToF(w.tempC))}°F</span>
      <span><b>Rain</b> ${Math.round(w.rainChance)}%</span>
    </div>
  `;
}
function buildHotTopics(t) {
  var topics = (t.topics || []).map(function (topic) {
    var chips = (topic.keywords || []).map(function (k) {
      return `<span class="chip">${esc(k)}</span>`;
    }).join("");
    return `
      <li class="topic">
        <div class="topic-chips">${chips}</div>
        <div class="topic-summary">${esc(topic.summary || "")}</div>
      </li>
    `;
  }).join("");
  return `
    <div class="card-title">${esc(t.headline || "Today's buzz")}</div>
    <ul class="topics-list">${topics}</ul>
  `;
}
function buildMarket(m) {
  var indices = m.indices || [];
  var regionOrder = ["US", "Europe", "Asia"];
  var grouped = regionOrder.map(function (region) {
    return {
      region,
      items: indices.filter(function (i) {
        return i.region === region;
      })
    };
  }).filter(function (g) {
    return g.items.length;
  });
  var cols = grouped.map(function (_ref) {
    var region = _ref.region,
      items = _ref.items;
    var open = isMarketOpen(region);
    var cards = items.map(function (idx) {
      var up = idx.changePct >= 0;
      var arrow = up ? "▲" : "▼";
      var sign = up ? "+" : "";
      return `
        <div class="index">
          <div class="index-name">${esc(idx.name)}</div>
          <div class="index-price">${formatNumber(idx.price, 2)}</div>
          <div class="index-change ${up ? "up" : "down"}">${arrow} ${sign}${idx.changePct.toFixed(2)}%</div>
        </div>
      `;
    }).join("");
    return `
      <div class="region-col${items.length > 2 ? " region-col--dense" : ""}">
        <div class="region-head">
          <span class="region-label">${esc(region)}</span>
          <span class="badge ${open ? "live" : "closed"}"><span class="dot"></span>${open ? "Live" : "Closed"}</span>
        </div>
        ${cards}
      </div>
    `;
  }).join("");
  return `
    <div class="card-title">Markets around the world</div>
    <div class="market-grid">${cols}</div>
  `;
}
function buildJoke(j) {
  var en = j.en || {};
  var zh = j.zh || {};
  var enWhy = en.explanation ? `<div class="joke-why">${esc(en.explanation)}</div>` : "";
  return `
    <div class="card-title">Joke of the day · 今日笑话</div>
    <div class="joke-grid">
      <div class="joke-panel joke-en">
        <div class="joke-lang">EN</div>
        <div class="joke-text">${esc(en.joke || "")}</div>
        ${enWhy}
      </div>
      <div class="joke-panel joke-zh">
        <div class="joke-lang">中文</div>
        <div class="joke-text">${esc(zh.joke || "")}</div>
      </div>
    </div>
  `;
}
function buildFamousPeople(p) {
  var people = (p.people || []).map(function (person) {
    var _person$highlights;
    var highlights = (_person$highlights = person.highlights) !== null && _person$highlights !== void 0 && _person$highlights.length ? `<ul class="person-highlights">${person.highlights.map(function (h) {
      return `<li>${esc(h)}</li>`;
    }).join("")}</ul>` : `<div class="person-bio">${esc(person.bio || person.extract || "")}</div>`;
    return `
    <li class="person">
      <img class="person-photo" src="${esc(person.photoUrl)}" alt="${esc(person.name)}" loading="lazy">
      <div class="person-name">${esc(person.name)}${person.born ? ` <span class="person-born">b. ${esc(person.born)}</span>` : ""}</div>
      ${highlights}
    </li>
  `;
  }).join("");
  return `
    <div class="card-title">${esc(p.headline || "Born today")}</div>
    <ul class="people-list">${people}</ul>
  `;
}

/* ---------- assemble ---------- */

function render(data) {
  stage.innerHTML = "";
  dotsNav.innerHTML = "";
  cards = [];
  var plan = [data.weather && {
    kind: "weather",
    build: function build() {
      return buildWeather(data.weather);
    }
  }, data.hotTopics && {
    kind: "hotTopics",
    build: function build() {
      return buildHotTopics(data.hotTopics);
    }
  }, data.market && {
    kind: "market",
    build: function build() {
      return buildMarket(data.market);
    }
  }, data.joke && {
    kind: "joke",
    build: function build() {
      return buildJoke(data.joke);
    }
  }, data.famousPeople && {
    kind: "famousPeople",
    build: function build() {
      return buildFamousPeople(data.famousPeople);
    }
  }].filter(Boolean);
  plan.forEach(function (item, i) {
    var el = document.createElement("section");
    el.className = "card";
    el.dataset.kind = item.kind;
    el.innerHTML = decorations(item.kind) + item.build();
    stage.appendChild(el);
    cards.push(el);
    var dot = document.createElement("button");
    dot.addEventListener("click", function () {
      return goto(i);
    });
    dotsNav.appendChild(dot);
  });
  current = 0;
  show(0);
  startRotation();
}
function show(i) {
  cards.forEach(function (el, idx) {
    return el.classList.toggle("is-active", idx === i);
  });
  Array.prototype.slice.call(dotsNav.children).forEach(function (d, idx) {
    return d.classList.toggle("active", idx === i);
  });
}
function goto(i) {
  current = (i + cards.length) % cards.length;
  show(current);
  startRotation(); // reset timer on manual nav
}
function next() {
  goto(current + 1);
}
function startRotation() {
  clearInterval(rotateTimer);
  rotateTimer = setInterval(next, ROTATE_MS);
}

/* ---------- data loading ---------- */
function load() {
  return _load.apply(this, arguments);
} // Tap anywhere (except dots) to advance
function _load() {
  _load = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee() {
    var res, data, _t;
    return _regenerator().w(function (_context) {
      while (1) switch (_context.p = _context.n) {
        case 0:
          _context.p = 0;
          _context.n = 1;
          return fetch("data.json", {
            cache: "no-store"
          });
        case 1:
          res = _context.v;
          if (res.ok) {
            _context.n = 2;
            break;
          }
          throw new Error(`HTTP ${res.status}`);
        case 2:
          _context.n = 3;
          return res.json();
        case 3:
          data = _context.v;
          render(data);
          _context.n = 5;
          break;
        case 4:
          _context.p = 4;
          _t = _context.v;
          stage.innerHTML = `<div class="error">Couldn't load the board — ${esc(_t.message)}</div>`;
          console.error(_t);
        case 5:
          return _context.a(2);
      }
    }, _callee, null, [[0, 4]]);
  }));
  return _load.apply(this, arguments);
}
document.addEventListener("click", function (e) {
  if (!e.target.closest(".dots") && cards.length) next();
});
load();
setInterval(load, RELOAD_MS);