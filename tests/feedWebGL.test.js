

// var index = require('../dist/index');
import feedWebGL_is_loaded from "../dist/index";

var EXAMPLE_SHADER = `#version 300 es
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

describe('testing feedWebGL', () => {

    it('loads the feedWebGL index', () => {
        //expect(true).toEqual(true);
        expect(feedWebGL_is_loaded()).toBe(true);
    });

    it('creates a context', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        expect(context.gl).toBeTruthy();
    });

    it('allocates a buffer', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var buffer = context.buffer(null, 4);
        expect(buffer.name).toBeTruthy();
        expect(context.buffers[buffer.name]).toEqual(buffer);
    });

    it('sizes a buffer', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var buffer = context.buffer(null, 4);
        buffer.allocate_size(13);
        expect(buffer.byte_size).toEqual(4*13);
    });

    it('filters degenerate entries', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var sentinel = [-1,1,1,-1];
        var from_buffer = [1,2, 3,4, 5,6, 7,8];
        var to_buffer = [0,0,0,0];
        var num_components = 2;
        to_buffer = context.filter_degenerate_entries(
            sentinel, from_buffer, to_buffer, num_components
        );
        expect(to_buffer).toEqual([3,4, 5,6])
    });

    it('filters degenerate entries up to limit', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var sentinel = [-1,1,1,-1];
        var from_buffer = [1,2, 3,4, 5,6, 7,8];
        var to_buffer = [0,0];
        var num_components = 2;
        to_buffer = context.filter_degenerate_entries(
            sentinel, from_buffer, to_buffer, num_components
        );
        expect(to_buffer).toEqual([3,4])
    });

    it('fills degenerate entries', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var sentinel = [-1,-1,1,-1];
        var from_buffer = [1,2, 3,4, 5,6, 7,8];
        var to_buffer = [0,0,0,0];
        var fill = -1;
        var num_components = 2;
        to_buffer = context.filter_degenerate_entries(
            sentinel, from_buffer, to_buffer, num_components, fill
        );
        expect(to_buffer).toEqual([5,6,-1,-1])
    });

    it('initializes a buffer from an array', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var buffer = context.buffer(null, 4);
        var valuesArray = new Float32Array([1,2,3,3,5]);
        buffer.initialize_from_array(valuesArray);
        expect(buffer.byte_size).toEqual(4*5);
    });

    it('creates a program', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:false};
        var program = context.program(options);
        expect(program.name).toBeTruthy();
        expect(program.gl_program).toBeNull();
        expect(context.programs[program.name]).toEqual(program);
    });

    it('compiles and links a program', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:true};
        var program = context.program(options);
        expect(program.name).toBeTruthy();
        expect(program.gl_program).toBeTruthy();
        expect(context.programs[program.name]).toEqual(program);
    });

    it('fails a compile', () => {
        var mockoptions = {fail_compile: true};
        mockCanvas(window, mockoptions);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:false};
        var program = context.program(options);
        expect(program.name).toBeTruthy();
        var compile_fn = (() => program.compile());
        expect(compile_fn).toThrow()
        var check_fn = (() => program.check_error());
        expect(check_fn).toThrow()
    });

    it('fails a link', () => {
        var mockoptions = {fail_link: true};
        mockCanvas(window, mockoptions);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:false};
        var program = context.program(options);
        var compile_fn = (() => program.compile());
        expect(compile_fn).toThrow()
        expect(program.error).toEqual("Error linking shader program");
    });

    it('makes feedback variables', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            feedbacks: {
                feedback_A: {num_components: 3},
                feedback_B: {bytes_per_component: 2},
            },
        };
        var program = context.program(options);
        var fA = program.feedbacks_by_name.feedback_A;
        var fB = program.feedbacks_by_name.feedback_B;
        expect(fA).toBeTruthy();
        expect(fB).toBeTruthy();
        expect(program.feedback_order[fA.index]).toEqual(fA);
        expect(fA.num_components).toEqual(3);
        expect(fB.bytes_per_component).toEqual(2);
        var fvs = program.feedback_variables();
        expect(fvs[fB.index]).toEqual("feedback_B");
    });

    it('makes a runner', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
        };
        var program = context.program(options);
        var roptions = {num_instances: 1000000};
        var runr = program.runner(roptions);
        expect(runr.name).toBeTruthy();
        expect(program.runners[runr.name]).toBe(runr);
        expect(runr.num_instances).toBe(1000000);
    });

    it('allocates feedback buffers', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            feedbacks: {
                feedback_A: {num_components: 3},
                feedback_B: {bytes_per_component: 2},
            },
        };
        var program = context.program(options);
        var roptions = {num_instances: 100, vertices_per_instance: 4};
        var runr = program.runner(roptions);
        runr.allocate_feedback_buffers();
        var allocated = runr.allocated_feedbacks;
        var allocated_A = allocated.feedback_A;
        expect(allocated_A.runner).toBe(runr);
        expect(allocated_A.name).toBe("feedback_A");
        // instances * vertices * ncomponents * bytes
        expect(allocated_A.buffer_bytes).toBe(100 * 4 * 3 * 4);
    });

    it('gets arrays and vectors from feedback buffers', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            feedbacks: {
                feedback_A: {num_components: 3},
                feedback_B: {bytes_per_component: 4, num_components: 2},
            },
        };
        var program = context.program(options);
        var roptions = {num_instances: 13, vertices_per_instance: 4};
        var runr = program.runner(roptions);
        runr.allocate_feedback_buffers();
        var vectors_A = runr.feedback_vectors("feedback_A")
        expect(vectors_A.length).toEqual(13 * 4);
        var array_B = runr.feedback_array("feedback_B");
        expect(array_B.length).toEqual(13 * 4 * 2);
        var array_alias = runr.feedback_array("feedback_B", array_B);
        expect(array_alias).toBe(array_B);
    });
    
    it('copies feedback buffers', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            feedbacks: {
                feedback_A: {num_components: 3},
                feedback_B: {bytes_per_component: 4, num_components: 2},
            },
        };
        var program = context.program(options);
        var roptions = {num_instances: 13, vertices_per_instance: 4};
        var runr = program.runner(roptions);
        runr.allocate_feedback_buffers();
        var allocated = runr.allocated_feedbacks;
        var allocated_A = allocated.feedback_A;
        var allocated_B = allocated.feedback_B;
        var copy_to_buffer = context.buffer();
        var total_size = allocated_A.feedback_buffer.num_elements + allocated_B.feedback_buffer.num_elements
        copy_to_buffer.allocate_size(total_size);
        allocated_A.copy_into_buffer(copy_to_buffer);
        allocated_B.copy_into_buffer(copy_to_buffer, allocated_A.feedback_buffer.num_elements);
    });

    it('creates vector and matrix uniforms', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
        };
        var program = context.program(options);
        var roptions = {
            num_instances: 1000000,
            uniforms: {
                translation: {
                    vtype: "4fv",
                    default_value: [-1, -1, -1, 0],
                },
                affine_transform: {
                    vtype: "4fv",
                    is_matrix: true,
                    default_value: [0,1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1, ],
                },
            },
        };
        var run = program.runner(roptions);
        var uniforms = run.uniforms;
        var t = uniforms.translation;
        var a = uniforms.affine_transform;
        expect(t.name).toEqual("translation")
        expect(t.vtype).toEqual("4fv")
        expect(t.is_matrix()).toBe(false);
        expect(a.is_matrix()).toBe(true);
        expect(t.value).toEqual([-1, -1, -1, 0]);
    });

    it('installs uniforms', () => {
        var mockoptions = {dump_methods: true};
        mockCanvas(window, mockoptions);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
        };
        var program = context.program(options);
        var roptions = {
            num_instances: 1000000,
            uniforms: {
                translation: {
                    vtype: "4fv",
                    default_value: [-1, -1, -1, 0],
                },
                affine_transform: {
                    vtype: "4fv",
                    is_matrix: true,
                    default_value: [0,1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1, ],
                },
            },
        };
        var run = program.runner(roptions);
        run.install_uniforms();
        var uniforms = run.uniforms;
        var t = uniforms.translation;
        var a = uniforms.affine_transform;
        expect(t.location).toBeTruthy();
        expect(a.location).toBeTruthy();
    });

    it('creates mesh and vertex inputs', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            compile_now: false,
        };
        var program = context.program(options);
        var roptions = {
            num_instances: 1000000,
            inputs: {
                "location": {
                    per_vertex: false,  // mesh input
                    num_components: 3,
                },
                "scale": {},  // implicitly just one component
                "point_offset":  {
                    //per_vertex: true,  // repeat for every mesh (implicit)
                    num_components: 3,
                },
            },
        };
        var runr = program.runner(roptions);
        var inputs = runr.inputs;
        var l = inputs.location;
        var s = inputs.scale;
        var p = inputs.point_offset;
        expect(s.name).toEqual("scale");
        expect(p.runner).toBe(runr);
        expect(s.num_components).toEqual(1);
        expect(l.num_components).toEqual(3);
        expect(l.is_mesh_input()).toEqual(true);
        expect(p.is_mesh_input()).toEqual(false);
    });

    it('binds mesh and vertex inputs to a buffer', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
        };
        var program = context.program(options);
        var roptions = {
            num_instances: 1000000,
            inputs: {
                "location": {
                    num_components: 3,
                },
                "scale": {},  // implicitly just one component
                "point_offset":  {
                    per_vertex: true,  // repeat for every mesh
                    num_components: 3,
                },
            },
        };
        var runr = program.runner(roptions);
        var inputs = runr.inputs;
        var l = inputs.location;
        var s = inputs.scale;
        var p = inputs.point_offset;
        var buffer = context.buffer(null, 4);
        var valuesArray = new Float32Array([1,2,3,3,5]);
        buffer.initialize_from_array(valuesArray);
        p.bindBuffer(buffer);
        s.bindBuffer(buffer, 2, 1);
        expect(s.byte_offset).toEqual(2 * 1 * 4);
    });

    it('binds mesh and vertex inputs to named buffers', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2({
            buffers: {
                "location_buffer": {
                    num_components: 3,
                    vectors: [
                        [0,0,1],
                        [1,1,0],
                        [1,1,1],
                    ],
                },
                "scale_buffer": {
                    // implicitly one component
                    array: new Float32Array([1,2,3,3,5]),
                },
            },
        });
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
        };
        var program = context.program(options);

        var roptions = {
            num_instances: 1000000,
            inputs: {
                "location": {
                    bytes_per_element: 4,
                    from_buffer: {
                        name: "location_buffer",  // implicitly densely packed, no skip
                    },
                },
                "scale": {
                    from_buffer: {
                        name: "scale_buffer",
                    },
                },  // implicitly just one component
                "point_offset":  {
                    per_vertex: true,  // repeat for every mesh
                    num_components: 3,
                    from_buffer: {
                        name: "location_buffer",
                        skip_elements: 2,
                        element_stride: 1,
                    }
                },
            },
        };
        var runr = program.runner(roptions);
        var inputs = runr.inputs;
        var l = inputs.location;
        var s = inputs.scale;
        var p = inputs.point_offset;
        // 2 elements, 3 components, 4 bytes each
        expect(p.byte_offset).toEqual(2 * 3 * 4);
        // 1 element, 3 components, 4 bytes
        expect(p.byte_stride).toEqual(1 * 3 * 4);
    });

    it('completes a mock run', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2({
            buffers: {
                "location_buffer": {
                    num_components: 3,
                    vectors: [
                        [0,0,1],
                        [1,1,0],
                        [1,1,1],
                    ],
                },
                "scale_buffer": {
                    // implicitly one component
                    array: new Float32Array([1,2,3,3,5]),
                },
            },
        });
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            feedbacks: {
                feedback_A: {num_components: 3},
                feedback_B: {bytes_per_component: 4, num_components: 2},
            },
        };
        var program = context.program(options);
        var roptions = {
            num_instances: 10, 
            vertices_per_instance: 7,
            uniforms: {
                translation: {
                    vtype: "4fv",
                    default_value: [-1, -1, -1, 0],
                },
                affine_transform: {
                    vtype: "4fv",
                    is_matrix: true,
                    default_value: [0,1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1, ],
                },
            },
            inputs: {
                "location": {
                    bytes_per_element: 4,
                    from_buffer: {
                        name: "location_buffer",  // implicitly densely packed, no skip
                    },
                },
                "scale": {
                    from_buffer: {
                        name: "scale_buffer",
                    },
                },  // implicitly just one component
                "point_offset":  {
                    per_vertex: true,  // repeat for every mesh
                    num_components: 3,
                    from_buffer: {
                        name: "location_buffer",
                        skip_elements: 2,
                        element_stride: 1,
                    }
                },
            },
        };
        var runr = program.runner(roptions);
        runr.run();
        expect(runr.run_count).toEqual(1);
    });

    it('runs the trivial example in mocking mode', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var runr = jQuery.fn.feedWebGL2.trivial_example(d);
        expect(runr.run_count).toEqual(1);
    });

    it('runs the example in mocking mode', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var runr = jQuery.fn.feedWebGL2.trivial_example(d);
        expect(runr.run_count).toEqual(1);
    });

    it('runs the 2d contour example in mocking mode', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var contours = jQuery.fn.webGL2contours2d.simple_example(d);
        expect(contours.runner.run_count).toEqual(1);
    });

  });
