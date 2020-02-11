
// jQuery plugin for webGL feedback programs.

/*
todo:

get feedback array
runner.run
data loading convenience interfaces on runner.
*/

(function($) {
    $.fn.feedWebGL2 = function (options) {
        var jquery_object = this;

        class FeedbackContext {
            
            constructor(options) {
                this.settings = $.extend({
                    // default settings:
                    gl: null,    // the underlying gl context to use
                    buffers: {},
                }, options);

                // set up the context if needed.
                var canvas = null;
                var gl = this.settings.gl;
                if (!gl) {
                    // create a webgl context
                    var canvas = document.createElement( 'canvas' ); 
                    gl = canvas.getContext( 'webgl2', { alpha: false } ); 
                }
                this.gl = gl;
                this.canvas = canvas;
                this.counter = 0;
                this.buffers = {};
                this.programs = {};
                this.error = null;

                // allocate buffers
                for (var name in this.settings.buffers) {
                    var desc = this.settings.buffers[name];
                    var bytes_per_element = desc.bytes_per_element || 4;
                    var buffer = this.buffer(name, bytes_per_element);
                    var vectors = desc.vectors;
                    var array = desc.array;
                    if (vectors) {
                        // vectors automatically override any array
                        buffer.initialize_from_vectors(vectors)
                    } else if (array) {
                        buffer.initialize_from_array(array);
                    } else {
                        throw new Error("buffer descriptor must specify array or vector initial values.")
                    }
                }
            };
            fresh_name(prefix) {
                this.counter += 1;
                return prefix + this.counter;
            };
            get_buffer(name) {
                var result = this.buffers[name];
                if (!result) {
                    throw new Error("no such buffer name " + name);
                }
                return result;
            }
            buffer(name, bytes_per_element) {
                name = name || this.fresh_name("buffer");
                var buffer = new FeedbackBuffer(this, name, bytes_per_element);
                this.buffers[name] = buffer;
                return buffer;
            };
            program(options) {
                var prog = new FeedbackProgram(this, options);
                this.programs[prog.name] = prog;
                return prog;
            };
        };

        var noop_fragment_shader = `#version 300 es
        #ifdef GL_ES
            precision highp float;
        #endif
        
        out vec4 color;

        void main() {
            color = vec4(1.0, 0.0, 0.0, 1.0);
        }
        `;

        class FeedbackProgram {
            constructor(context, options) {
                this.settings = $.extend({
                    // default settings:
                    name: null,
                    vertex_shader: null,
                    fragment_shader: noop_fragment_shader,
                    run_type: "POINTS",   // run glsl program point by point (not triangles or lines, default)
                    feedbacks: {
                        "gl_Position": {
                            num_components: 4,
                            bytes_per_component: 4,
                        },
                    },
                    uniforms: {
                        //"translation": {
                        //    // https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/unifor
                        //    vtype: "4fv",
                        //    default_value: [-1, -1, -1, 0],
                        //},
                        //"affine_transform": {
                        //    // https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/unifor
                        //    vtype: "4fv",
                        //    is_matrix: true,
                        //    default_value: [0,1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1, ],
                        //},
                    },
                    inputs: {
                    //    "location": {
                    //        num_components: 3,
                    //    },
                    //    "scale": {},  // implicitly just one component
                    //    "point_offset":  {
                    //        per_vertex: true,  // repeat for every mesh
                    //        num_components: 3,
                    //    }
                    },
                    compile_now: true
                }, options);
                if (!this.settings.vertex_shader) {
                    throw new Error("feedback program requires a vertex shader.");
                }
                this.error = null;
                this.context = context;
                this.name = this.settings.name || context.fresh_name("program");
                // preprocess the feedbacks
                this.feedbacks_by_name = {};
                this.feedback_order = [];
                this.runners = {};
                for (var name in this.settings.feedbacks) {
                    var feedback_desc = this.settings.feedbacks[name];
                    var feedback = new FeedbackVariable(this, name, feedback_desc.num_components, feedback_desc.bytes_per_component);
                    this.feedbacks_by_name[name] = feedback;
                    this.feedback_order.push(feedback);
                    feedback.index = this.feedback_order.length - 1;
                }
                // compile program in separate step for easy testing.
                this.gl_program = null;
                if (this.settings.compile_now) {
                    this.compile();
                }
            };
            runner(num_instances, vertices_per_instance, name, run_type) {
                name = name || this.context.fresh_name("runner");
                run_type = run_type || this.settings.run_type;
                vertices_per_instance = vertices_per_instance || 1;
                var run = new FeedbackRunner(this, num_instances, vertices_per_instance, name, run_type);
                this.runners[run.name] = run;
                return run;
            };
            feedback_variables() {
                return this.feedback_order.map(x => x.name);
            }
            compile() {
                var context = this.context;
                var gl = context.gl;
                var vertex_shader_code = this.settings.vertex_shader;
                var fragment_shader_code = this.settings.fragment_shader;
                this.gl_program = context.gl.createProgram();
                // compile shaders
                this.vertex_shader = this.compileShader(vertex_shader_code, gl.VERTEX_SHADER);
                this.fragment_shader = this.compileShader(fragment_shader_code, gl.FRAGMENT_SHADER);
                // set up feedbacks...
                var varyings = this.feedback_variables();
                gl.transformFeedbackVaryings(this.gl_program, varyings, gl.SEPARATE_ATTRIBS);
                gl.linkProgram(this.gl_program);
                if (!gl.getProgramParameter(this.gl_program, gl.LINK_STATUS)) {
                    var err = "Error linking shader program";
                    this.error = err;
                    console.log(gl.getProgramInfoLog(this.gl_program));
                    throw new Error(err);
                }
                return this.gl_program;
            };
            check_error() {
                if (this.error) {
                    throw new Error("previous error: " + this.error);
                }
            };
            compileShader(code, type) {
                this.check_error();
                var gl = this.context.gl;
                var program = this.gl_program;
                let shader = gl.createShader(type);
                gl.shaderSource(shader, code);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    var err = `Error compiling ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader:`;
                    console.log(err);
                    console.log(gl.getShaderInfoLog(shader));
                    this.error = err;
                    throw new Error(err);
                } else {
                    gl.attachShader(program, shader);
                }
                return shader;
            };
        };

        class FeedbackRunner {
            constructor(program, num_instances, vertices_per_instance, name, run_type) {
                this.program = program;
                var context = program.context;
                this.vertices_per_instance = vertices_per_instance;
                this.num_instances = num_instances;
                this.name = name;
                this.run_type = run_type;
                // preprocess the uniforms defined for the program
                var uniform_descriptions = program.settings.uniforms;
                this.uniforms = {};
                for (var name in uniform_descriptions) {
                    var desc = uniform_descriptions[name];
                    var uniform = null;
                    if (desc.is_matrix) {
                        uniform = new MatrixUniform(this, name, desc.vtype, desc.default_value);
                    } else {
                        uniform = new VectorUniform(this, name, desc.vtype, desc.default_value);
                    }
                    this.uniforms[name] = uniform;
                }
                // preprocess instance inputs defined for the program
                this.inputs = {};
                var input_descriptions = program.settings.inputs;
                for (var name in input_descriptions) {
                    var desc = input_descriptions[name];
                    var input = null;
                    if (desc.per_vertex) {
                        input = new VertexInput(this, name, desc.num_components);
                    } else {
                        input = new MeshInput(this, name, desc.num_components);
                    }
                    var from_buffer = desc.from_buffer;
                    if (from_buffer) {
                        var buffer = context.get_buffer(from_buffer.name);
                        var skip_elements = from_buffer.skip_elements || 0;
                        var element_stride = from_buffer.element_stride || 0;
                        input.bindBuffer(buffer, skip_elements, element_stride);
                    }
                    this.inputs[name] = input;
                }
                this.allocated_feedbacks = null;
                this.uniforms_installed = false;
                this.run_count = 0;
            };
            check_input_bindings() {
                var unbound = [];
                for (var name in this.inputs) {
                    if (!this.inputs[name].bound) {
                        unbound.push(name);
                    }
                }
                if (unbound.length > 0) {
                    throw new Error("No buffer bound to inputs in run: " + unbound);
                }
            };
            run() {
                this.check_input_bindings();
                var program = this.program;
                var gl = program.context.gl;
                gl.useProgram(program.gl_program);
                if (!this.allocated_feedbacks) {
                    this.allocate_feedback_buffers();
                }
                if (!this.uniforms_installed) {
                    this.install_uniforms();
                }
                var mode_name = this.run_type || "POINTS";
                var mode = gl[mode_name];
                var rasterize = program.settings.rasterize;
                if (!rasterize) {
                    gl.enable(gl.RASTERIZER_DISCARD);
                }
                gl.beginTransformFeedback(mode);
                var vertices_per_instance = this.vertices_per_instance;
                var num_instances = this.num_instances;
                if ((num_instances) && (num_instances > 1)) {
                    gl.drawArraysInstanced(mode, 0, vertices_per_instance, num_instances);
                } else {
                    gl.drawArrays(mode, 0, vertices_per_instance);
                }
                gl.endTransformFeedback();
                if (!rasterize) {
                    gl.disable(gl.RASTERIZER_DISCARD);
                }
                gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
                this.run_count += 1;  // mainly for debug and test.
            };
            install_uniforms() {
                var program = this.program;
                var gl = program.context.gl;
                gl.useProgram(program.gl_program);
                for (var name in this.uniforms) {
                    this.uniforms[name].install();
                }
                this.uniforms_installed = true;
            };
            allocate_feedback_buffers() {
                // should deallocate if already allocated???
                this.allocated_feedbacks = {};
                var number_of_outputs = this.vertices_per_instance * this.num_instances;
                var program = this.program;
                var gl = program.context.gl;
                this.transformFeedback = gl.createTransformFeedback();
                gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedback);
                // allocate feedback buffers IN THE RIGHT ORDER as specified during the link.
                var feedback_order = program.feedback_order;
                for (var i=0; i<feedback_order.length; i++) {
                    var feedback = feedback_order[i];
                    var allocated = feedback.allocate_buffer(i, this, number_of_outputs);
                    this.allocated_feedbacks[feedback.name] = allocated;
                }
            };
            feedback_array(name, optionalPreAllocatedArrBuffer) {
                var feedback = this.allocated_feedbacks[name];
                return feedback.get_array(optionalPreAllocatedArrBuffer);
            };
            feedback_vectors(name) {
                var feedback = this.allocated_feedbacks[name];
                return feedback.get_vectors();
            };
        };

        class FeedbackBuffer {
            constructor(context, name, bytes_per_element) {
                this.context = context;
                this.name = name;
                this.bytes_per_element = bytes_per_element || 4;
                this.buffer = context.gl.createBuffer();
                this.byte_size = null;
                this.num_elements = null;
            };
            initialize_from_array(array) {
                if (this.bytes_per_element != array.BYTES_PER_ELEMENT) {
                    throw new Error("byte per element must match " + this.bytes_per_element + " <> " + array.BYTES_PER_ELEMENT);
                }
                this.num_elements = array.length;
                this.byte_size = this.bytes_per_element * this.num_elements;
                var gl = this.context.gl;
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
                gl.bufferData(gl.ARRAY_BUFFER, array, gl.DYNAMIC_COPY);  //  ?? dynamic copy??
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
            };
            initialize_from_vectors(vectors) {
                var all_values = [];
                for (var i=0; i<vectors.length; i++) {
                    var vec = vectors[i];
                    for (var j=0; j<vec.length; j++) {
                        all_values.push(vec[j]);
                    }
                }
                var array = new Float32Array(all_values);
                this.initialize_from_array(array);
            }
            allocate_size(num_elements) {
                this.num_elements = num_elements;
                this.byte_size = this.bytes_per_element * num_elements;
                var gl = this.context.gl;
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
                gl.bufferData(gl.ARRAY_BUFFER, this.byte_size, gl.DYNAMIC_COPY);  //  ?? dynamic copy??
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
            };
        };

        class FeedbackVariable {
            constructor(program, name, num_components, bytes_per_component) {
                this.program = program;
                this.name = name;
                this.num_components = num_components || 1;
                this.bytes_per_component = bytes_per_component || 4;
            };
            allocate_buffer(feedback_index, runner, number_of_outputs) {
                return new AllocatedFeedbackVariable(feedback_index, this, runner, number_of_outputs);
            };
        };

        class AllocatedFeedbackVariable {
            constructor(feedback_index, feedback_variable, runner, number_of_outputs) {
                this.name = feedback_variable.name;   // convenience for debugging
                this.feedback_index = feedback_index;
                this.feedback_variable = feedback_variable;
                this.runner = runner;
                this.number_of_outputs = number_of_outputs;
                this.output_components = this.feedback_variable.num_components * number_of_outputs;
                this.buffer_bytes = this.feedback_variable.bytes_per_component * this.output_components;
                var context = this.feedback_variable.program.context;
                var gl = context.gl;
                this.feedback_buffer = context.buffer(context.fresh_name("feedbackBuffer"), this.bytes_per_element);
                this.feedback_buffer.allocate_size(this.output_components);
                gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, feedback_index, this.feedback_buffer.buffer);
            };
            get_array(arrBuffer) {
                if (!arrBuffer) {
                    arrBuffer = new Float32Array(this.output_components);
                }
                var gl = this.feedback_variable.program.context.gl;
                gl.flush();   // make sure processing has completed (???)
                gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.feedback_buffer.buffer);
                gl.getBufferSubData(gl.ARRAY_BUFFER, 0, arrBuffer);
                return arrBuffer;
            };
            get_vectors() {
                var arrBuffer = this.get_array();
                var num_components = this.feedback_variable.num_components;
                var max_index = this.output_components / num_components;
                var vectors = [];
                for (var i=0; i<max_index; i++) {
                    var v = [];
                    for (var j=0; j<num_components; j++) {
                        var index = i*num_components + j;
                        var val = arrBuffer[index];
                        v.push(val);
                    }
                    vectors.push(v);
                }
                return vectors;
            }
        };

        class VectorUniform {
            constructor (runner, name, vtype, default_value) {
                this.runner = runner;
                this.name = name;
                this.vtype = vtype;
                this.value = default_value;
            };
            is_matrix() {
                return false;  // mainly for testing
            };
            method_name() {
                return "uniform" + this.vtype;
            };
            call_method(gl) {
                var method = gl[this.method_name()];
                method.call(gl, this.location, this.value);
            };
            install() {
                var program = this.runner.program;
                var gl = program.context.gl;
                this.location = gl.getUniformLocation(program.gl_program, this.name);
                //var method_name = this.method_name();
                //console.log("method name " + method_name);
                //var method = gl[this.method_name()];
                //method.call(gl, this.location, this.value);
                this.call_method(gl)
            };
        };

        class MatrixUniform extends VectorUniform {
            // xxxxx
            is_matrix() {
                return true;  // mainly for testing
            };
            method_name() {
                return "uniformMatrix" + this.vtype;
            };
            call_method(gl) {
                var method = gl[this.method_name()];
                method.call(gl, this.location, false, this.value);
            };
        };

        class MeshInput {
            constructor (runner, name, num_components) {
                this.runner = runner;
                this.name = name;
                this.num_components = num_components || 1;
                this.position = null;
                this.bound = false;
            };
            is_mesh_input() {
                return true;  // mainly for testing
            };
            bindBuffer(tf_buffer, skip_elements, element_stride) {
                var gl = this.runner.program.context.gl;
                var shaderProgram = this.runner.program.gl_program;
                gl.bindBuffer(gl.ARRAY_BUFFER, tf_buffer.buffer);
                skip_elements = skip_elements || 0;
                element_stride = element_stride || 0;
                this.position = gl.getAttribLocation(shaderProgram, this.name);
                this.define_divisor(gl);
                gl.enableVertexAttribArray(this.position);
                this.byte_offset = skip_elements * this.num_components * tf_buffer.bytes_per_element;
                this.byte_stride = element_stride * this.num_components * tf_buffer.bytes_per_element;
                // ??? does webgl2 support types other than gl.float?
                gl.vertexAttribPointer(this.position, this.num_components,
                    gl.FLOAT, false, this.byte_stride, this.byte_offset);
                this.bound = true;
            };
            define_divisor(gl) {
                // one per mesh
                gl.vertexAttribDivisor(this.position, 1);
            };
        };

        class VertexInput extends MeshInput {
            is_mesh_input() {
                return false;  // mainly for testing
            };
            define_divisor(gl) {
                // no divisor: vertex element
                gl.vertexAttribDivisor(this.position, 0);
            };
        };

        return new FeedbackContext(options);
    };

    $.fn.feedWebGL2.trivial_example = function (container) {
        // example: switch first and second component

        var init_html = `<canvas id="glcanvas" width="600" height="600">
                            Oh no! Your browser doesn't support canvas!
                        </canvas>`;

        container.empty();
        var $canvas = $(init_html).appendTo(container);
        var glCanvas = $canvas[0];

        // **** webgl2!
        var gl = glCanvas.getContext("webgl2");
        // set up and clear the viewport
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        gl.clearColor(0.8, 0.9, 1.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        var switch_vertex_shader = `#version 300 es
            // per mesh input
            in vec3 input_vertex;

            // feedbacks out
            out vec3 output_vertex;

            // non-feedback out
            out vec3 vcolor;

            void main() {
                output_vertex[0] = input_vertex[1];
                output_vertex[1] = input_vertex[0];
                output_vertex[2] = input_vertex[2] -0.11;
                vcolor = abs(normalize(output_vertex));
                gl_Position.xyz = output_vertex;
                gl_Position[3] = 1.0;
            }
        `;
        var switch_fragment_shader = `#version 300 es
        #ifdef GL_ES
            precision highp float;
        #endif
        
        in vec3 vcolor;
        out vec4 color;

        void main() {
            color[3] = 1.0;
            color.xyz = vcolor;
        }
        `;

        var context = container.feedWebGL2({
            gl: gl,
            buffers: {
                "vertex_buffer": {
                    num_components: 3,
                    vectors: [
                        [0,0,1],
                        [1,-1,0],
                        [1,0,1],
                        [0,0,-1],
                        [-1,-1,0],
                        [-1,0,-1],
                    ],
                },
            },
        });

        var program = context.program({
            vertex_shader: switch_vertex_shader,
            fragment_shader: switch_fragment_shader,
            rasterize: true,  // display the result
            uniforms: {},
            inputs: {
                input_vertex:  {
                    per_vertex: true,
                    num_components: 3,  // 3 vector
                    from_buffer: {
                        name: "vertex_buffer",
                        skip_elements: 0,   // start at the beginning
                        element_stride: 0,  // dense packing
                    }
                },
            },
            feedbacks: {
                output_vertex: {num_components: 3},
            },
        });

        // 1 instances with 6 vertices per instance
        var runr = program.runner(1, 6, "switch coordinates", "TRIANGLES");

        runr.run()

        var location_array = runr.feedback_array("output_vertex");

        $("<h3>" + location_array.length + " output vertex floats</h3>").appendTo(container);

        var tf = function(x) { return x.toFixed(2); };

        for (var i=0; i<location_array.length; i++) {
            if (i % 3 == 0) {
                $("<br/>").appendTo(container);
                $("<b>" + (i/3) + ": </b>").appendTo(container);
            }
            $("<span> " + tf(location_array[i]) + "<span>").appendTo(container);
        }
        return runr;
    };

    $.fn.feedWebGL2.example = function (container) {
        // example: stretch triangle vertices in or out from the center

        var init_html = `<canvas id="glcanvas" width="600" height="600">
                            Oh no! Your browser doesn't support canvas!
                        </canvas>`;

        container.empty();
        var $canvas = $(init_html).appendTo(container);
        var glCanvas = $canvas[0];

        // **** webgl2!
        var gl = glCanvas.getContext("webgl2");
        // set up and clear the viewport
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        gl.clearColor(0.8, 0.9, 1.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        var distortion_vertex_shader = `#version 300 es

            uniform mat4 affine_transform;

            // per mesh inputs
            in vec3 vertexA, vertexB, vertexC;

            // per instance input
            in float distortion;

            // feedbacks out
            out vec3 location, vcolor;

            void main() {
                // initially invalid position
                gl_Position = vec4(-100.0, 0.0, 0.0, 1.0);
                location = gl_Position.xyz;
                vcolor = vec3(1.0, 0.0, 0.0);

                vec3 center = (vertexA + vertexB + vertexC) / 3.0;  // triangle center
                vec3[3] vertices = vec3[](vertexA, vertexB, vertexC); // triangle vertices
                vec3 this_vertex = vertices[gl_VertexID]; // the current vertex for this instance
                vec3 offset = this_vertex - center;
                vec3 shifted_vertex = (distortion * offset) + center;
                gl_Position.xyz = shifted_vertex;
                gl_Position[3] = 1.0;
                gl_Position = affine_transform * gl_Position;

                location = gl_Position.xyz;
                vcolor = abs(normalize(center));
            }

        `;
        var distortion_fragment_shader = `#version 300 es
            #ifdef GL_ES
                precision highp float;
            #endif
            
            in vec3 vcolor;
            out vec4 color;

            void main() {
                color[3] = 1.0;
                color.xyz = vcolor;
            }
            `;

        var context = container.feedWebGL2({
            gl: gl,
            buffers: {
                "vertex_buffer": {
                    num_components: 3,
                    vectors: [
                        [0,0,1],
                        [1,1,0],
                        [1,-1,1],
                        [0,0,-1],
                        [1,1,0],
                        [-1,1,-1],
                    ],
                },
                "scale_buffer": {
                    // implicitly one component
                    array: new Float32Array([0.5, 0.8, 0.3]),
                },
            },
        });

        var program = context.program({
            vertex_shader: distortion_vertex_shader,
            fragment_shader: distortion_fragment_shader,
            rasterize: true,  // display the result
            uniforms: {
                affine_transform: {
                    vtype: "4fv",
                    is_matrix: true,
                    default_value: [0,1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1, ],
                },
            },
            inputs: {
                "vertexA":  {
                    per_vertex: false,  // 1 per triangle
                    num_components: 3,  // 3 vector
                    from_buffer: {
                        name: "vertex_buffer",
                        skip_elements: 0,   // first point
                        element_stride: 3,  // skip 3 to get to next one
                    }
                },
                "vertexB":  {
                    per_vertex: false,  // 1 per triangle
                    num_components: 3,  // 3 vector
                    from_buffer: {
                        name: "vertex_buffer",
                        skip_elements: 1,   // second point
                        element_stride: 3,  // skip 3 to get to next one
                    }
                },
                "vertexC":  {
                    per_vertex: false,  // 1 per triangle
                    num_components: 3,  // 3 vector
                    from_buffer: {
                        name: "vertex_buffer",
                        skip_elements: 2,   // third point
                        element_stride: 3,  // skip 3 to get to next one
                    }
                },
                "distortion":  {
                    per_vertex: true,  // repeat for each triangle
                    num_components: 1, // scalar
                    from_buffer: {
                        name: "scale_buffer",
                        skip_elements: 0,
                        element_stride: 0,
                    }
                },
            },
            feedbacks: {
                location: {num_components: 3},
                vcolor: {bytes_per_component: 4, num_components: 3},
            },
        });

        // 2 instances with 3 vertices per instance
        var runr = program.runner(2, 3, "distort triangles", "TRIANGLES");

        runr.run()

        var location_array = runr.feedback_array("location");
        var color_array = runr.feedback_array("vcolor");

        $("<h3>" + location_array.length + " location floats</h3>").appendTo(container);

        var tf = function(x) { return x.toFixed(2); };

        for (var i=0; i<location_array.length; i++) {
            if (i % 3 == 0) {
                $("<br/>").appendTo(container);
                $("<b>" + (i/3) + ": </b>").appendTo(container);
            }
            $("<span> " + tf(location_array[i]) + "<span>").appendTo(container);
        }
        
        $("<h3>" + color_array.length + " color floats</h3>").appendTo(container);
        for (var i=0; i<color_array.length; i++) {
            if (i % 3 == 0) {
                $("<br/>").appendTo(container);
                $("<b>" + (i/3) + ": </b>").appendTo(container);
            }
            $("<span> " + tf(color_array[i]) + "<span>").appendTo(container);
        }
        return runr;
    };
})(jQuery);
